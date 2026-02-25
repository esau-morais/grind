import { and, desc, eq } from "drizzle-orm";

import type { Skill, SkillCategory } from "../../schema";
import { skillCategorySchema, skillSchema } from "../../schema";
import { skillLevelFromXp } from "../../xp";
import { skills } from "../schema";
import type { VaultDb, VaultTx } from "../types";

type DbOrTx = VaultDb | VaultTx;

function rowToSkill(row: typeof skills.$inferSelect): Skill {
  return skillSchema.parse({
    id: row.id,
    userId: row.userId,
    name: row.name,
    category: row.category,
    parentId: row.parentId ?? undefined,
    xp: row.xp,
    level: row.level,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export async function createSkill(
  db: DbOrTx,
  input: { userId: string; name: string; category: SkillCategory },
): Promise<Skill> {
  const [row] = await db
    .insert(skills)
    .values({
      userId: input.userId,
      name: input.name,
      category: input.category,
      metadata: {},
    })
    .returning();

  if (!row) throw new Error("Failed to insert skill");
  return rowToSkill(row);
}

export async function getSkillById(db: DbOrTx, skillId: string): Promise<Skill | null> {
  const row = await db.query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!row) return null;
  return rowToSkill(row);
}

export async function getSkillByName(
  db: DbOrTx,
  userId: string,
  name: string,
): Promise<Skill | null> {
  const row = await db.query.skills.findFirst({
    where: and(eq(skills.userId, userId), eq(skills.name, name)),
  });
  if (!row) return null;
  return rowToSkill(row);
}

export async function listSkillsByUser(db: DbOrTx, userId: string): Promise<Skill[]> {
  const rows = await db.query.skills.findMany({
    where: eq(skills.userId, userId),
    orderBy: [desc(skills.xp)],
  });
  return rows.map(rowToSkill);
}

export async function addXpToSkill(db: DbOrTx, skillId: string, deltaXp: number): Promise<Skill> {
  const row = await db.query.skills.findFirst({ where: eq(skills.id, skillId) });
  if (!row) throw new Error("Skill not found");

  const newXp = Math.max(0, row.xp + deltaXp);
  const newLevel = skillLevelFromXp(newXp);

  const [updated] = await db
    .update(skills)
    .set({ xp: newXp, level: newLevel })
    .where(eq(skills.id, skillId))
    .returning();

  if (!updated) throw new Error("Failed to update skill XP");
  return rowToSkill(updated);
}

function parseSkillTag(tag: string): { name: string; category: SkillCategory } {
  const defaultCategory: SkillCategory = "life";

  if (tag.includes(":")) {
    const [rawCategory, ...rest] = tag.split(":");
    const name = rest.join(":");
    const parsed = skillCategorySchema.safeParse(rawCategory);
    return {
      name: name || tag,
      category: parsed.success ? parsed.data : defaultCategory,
    };
  }

  return { name: tag, category: defaultCategory };
}

export async function upsertSkillByTag(db: DbOrTx, userId: string, tag: string): Promise<Skill> {
  const { name, category } = parseSkillTag(tag);

  const existing = await getSkillByName(db, userId, name);
  if (existing) return existing;

  return createSkill(db, { userId, name, category });
}

export interface SkillGain {
  skillId: string;
  name: string;
  category: string;
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  xpGained: number;
  leveledUp: boolean;
}

export async function distributeSkillXp(
  db: DbOrTx,
  userId: string,
  skillTags: string[],
  totalXp: number,
): Promise<SkillGain[]> {
  if (skillTags.length === 0 || totalXp <= 0) return [];

  const xpPerTag = computeXpDistribution(skillTags.length, totalXp);
  const gains: SkillGain[] = [];

  for (let i = 0; i < skillTags.length; i++) {
    const tag = skillTags[i];
    const xp = xpPerTag[i];
    if (tag === undefined || xp === undefined) continue;

    const skill = await upsertSkillByTag(db, userId, tag);
    const xpBefore = skill.xp;
    const levelBefore = skill.level;

    const updated = await addXpToSkill(db, skill.id, xp);

    gains.push({
      skillId: updated.id,
      name: updated.name,
      category: updated.category,
      xpBefore,
      xpAfter: updated.xp,
      levelBefore,
      levelAfter: updated.level,
      xpGained: xp,
      leveledUp: updated.level > levelBefore,
    });
  }

  return gains;
}

function computeXpDistribution(tagCount: number, totalXp: number): number[] {
  if (tagCount === 1) return [totalXp];

  const primaryXp = Math.ceil(totalXp * 0.5);
  const remaining = totalXp - primaryXp;
  const secondaryCount = tagCount - 1;
  const perSecondary = Math.floor(remaining / secondaryCount);

  const distribution = [primaryXp];
  let distributed = primaryXp;
  for (let i = 1; i < tagCount; i++) {
    const xp = i === tagCount - 1 ? totalXp - distributed : perSecondary;
    distribution.push(xp);
    distributed += xp;
  }

  return distribution;
}
