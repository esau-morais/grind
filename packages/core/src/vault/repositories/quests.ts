import { and, desc, eq, gte, inArray } from "drizzle-orm";

import type { CompleteQuestInput, CreateQuestInput, Quest, QuestStatus } from "../../schema";
import {
  completeQuestInputSchema,
  createQuestInputSchema,
  questDifficultySchema,
  questSchema,
} from "../../schema";
import { calculateQuestXp } from "../../xp";
import { levelFromXp } from "../../xp";
import { proofs, questLogs, quests, users } from "../schema";
import type { QuestLogRow } from "../schema";
import type { VaultDb } from "../types";
import { type SkillGain, distributeSkillXp } from "./skills";

function rowToQuest(row: typeof quests.$inferSelect): Quest {
  return questSchema.parse({
    id: row.id,
    userId: row.userId,
    title: row.title,
    description: row.description ?? undefined,
    type: row.type,
    difficulty: row.difficulty,
    status: row.status,
    objectives: row.objectives,
    skillTags: row.skillTags,
    schedule: row.scheduleCron ? { cron: row.scheduleCron, timezone: "UTC" } : undefined,
    parentId: row.parentId ?? undefined,
    streakCount: row.streakCount,
    baseXp: row.baseXp,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? undefined,
    deadlineAt: row.deadlineAt ?? undefined,
  });
}

export async function createQuest(db: VaultDb, input: CreateQuestInput): Promise<Quest> {
  const valid = createQuestInputSchema.parse(input);

  const [row] = await db
    .insert(quests)
    .values({
      userId: valid.userId,
      title: valid.title,
      description: valid.description,
      type: valid.type,
      difficulty: valid.difficulty,
      status: "active",
      objectives: valid.objectives,
      skillTags: valid.skillTags,
      scheduleCron: valid.schedule?.cron,
      parentId: valid.parentId,
      streakCount: valid.streakCount ?? 0,
      baseXp: valid.baseXp,
      metadata: valid.metadata,
      deadlineAt: valid.deadlineAt,
    })
    .returning();

  if (!row) throw new Error("Failed to insert quest");
  return rowToQuest(row);
}

export async function getQuestById(db: VaultDb, questId: string): Promise<Quest | null> {
  const row = await db.query.quests.findFirst({ where: eq(quests.id, questId) });
  if (!row) return null;
  return rowToQuest(row);
}

export async function findQuestByPrefix(
  db: VaultDb,
  userId: string,
  prefix: string,
): Promise<Quest | null> {
  const rows = await db.query.quests.findMany({
    where: eq(quests.userId, userId),
    orderBy: [desc(quests.updatedAt)],
  });

  const lowerPrefix = prefix.toLowerCase();
  const match = rows.find(
    (r) => r.id.startsWith(prefix) || r.title.toLowerCase().includes(lowerPrefix),
  );
  return match ? rowToQuest(match) : null;
}

export async function listQuestsByUser(
  db: VaultDb,
  userId: string,
  statusFilter?: QuestStatus[],
): Promise<Quest[]> {
  const where = statusFilter?.length
    ? and(eq(quests.userId, userId), inArray(quests.status, statusFilter))
    : eq(quests.userId, userId);

  const rows = await db.query.quests.findMany({
    where,
    orderBy: [desc(quests.updatedAt)],
  });

  return rows.map(rowToQuest);
}

export async function updateQuestStatus(
  db: VaultDb,
  questId: string,
  userId: string,
  status: QuestStatus,
): Promise<void> {
  const now = Date.now();
  await db
    .update(quests)
    .set({
      status,
      completedAt: status === "completed" ? now : null,
      streakCount: status === "abandoned" ? 0 : undefined,
    })
    .where(and(eq(quests.id, questId), eq(quests.userId, userId)));
}

export interface CompleteQuestResult {
  xpEarned: number;
  skillGains: SkillGain[];
}

export async function completeQuest(
  db: VaultDb,
  input: CompleteQuestInput & { userId: string },
): Promise<CompleteQuestResult> {
  const { userId, ...rest } = input;
  const validInput = completeQuestInputSchema.parse(rest);
  const completedAt = validInput.completedAt ?? Date.now();

  const quest = await db.query.quests.findFirst({
    where: and(eq(quests.id, validInput.questId), eq(quests.userId, userId)),
  });

  if (!quest) throw new Error("Quest not found");
  if (quest.status === "completed") throw new Error("Quest already completed");
  if (quest.status === "abandoned") throw new Error("Cannot complete an abandoned quest");

  const xpResult = calculateQuestXp({
    baseXp: quest.baseXp,
    difficulty: questDifficultySchema.parse(quest.difficulty),
    streakDays: quest.streakCount,
    proofType: validInput.proofType,
  });

  const skillTags = quest.skillTags;
  let skillGains: SkillGain[] = [];
  const proofConfidence =
    validInput.proofConfidence ??
    (typeof validInput.proofData.confidence === "number" &&
    validInput.proofData.confidence >= 0 &&
    validInput.proofData.confidence <= 1
      ? validInput.proofData.confidence
      : undefined);

  await db.transaction(async (tx) => {
    await tx
      .update(quests)
      .set({
        status: "completed",
        completedAt,
        streakCount: quest.streakCount + 1,
      })
      .where(eq(quests.id, validInput.questId));

    const [questLog] = await tx
      .insert(questLogs)
      .values({
        questId: quest.id,
        userId: quest.userId,
        completedAt,
        durationMinutes: validInput.durationMinutes,
        xpEarned: xpResult.totalXp,
        proofType: validInput.proofType,
        proofData: validInput.proofData,
        streakDay: quest.streakCount + 1,
      })
      .returning();

    if (!questLog) {
      throw new Error("Failed to insert quest log");
    }

    await tx.insert(proofs).values({
      questLogId: questLog.id,
      type: validInput.proofType,
      ...(proofConfidence !== undefined ? { confidence: proofConfidence } : {}),
      data: validInput.proofData,
    });

    const user = await tx.query.users.findFirst({ where: eq(users.id, quest.userId) });
    if (user) {
      const newXp = user.totalXp + xpResult.totalXp;
      await tx
        .update(users)
        .set({ totalXp: newXp, level: levelFromXp(newXp) })
        .where(eq(users.id, quest.userId));
    }

    skillGains = await distributeSkillXp(tx, quest.userId, skillTags, xpResult.totalXp);
  });

  return { xpEarned: xpResult.totalXp, skillGains };
}

export interface UpdateQuestPatch {
  title?: string;
  description?: string | null;
  type?: string;
  difficulty?: string;
  skillTags?: string[];
  baseXp?: number;
  scheduleCron?: string | null;
  deadlineAt?: number | null;
}

export async function updateQuest(
  db: VaultDb,
  questId: string,
  userId: string,
  patch: UpdateQuestPatch,
): Promise<Quest | null> {
  const set: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.difficulty !== undefined) set.difficulty = patch.difficulty;
  if (patch.skillTags !== undefined) set.skillTags = patch.skillTags;
  if (patch.baseXp !== undefined) set.baseXp = patch.baseXp;
  if (patch.scheduleCron !== undefined) set.scheduleCron = patch.scheduleCron;
  if (patch.deadlineAt !== undefined) set.deadlineAt = patch.deadlineAt;

  const [row] = await db
    .update(quests)
    .set(set)
    .where(and(eq(quests.id, questId), eq(quests.userId, userId)))
    .returning();

  return row ? rowToQuest(row) : null;
}

export interface ListQuestLogsOptions {
  limit?: number;
  since?: number;
}

export async function listQuestLogs(
  db: VaultDb,
  userId: string,
  options: ListQuestLogsOptions = {},
): Promise<QuestLogRow[]> {
  const { limit = 20, since } = options;
  const where = since
    ? and(eq(questLogs.userId, userId), gte(questLogs.completedAt, since))
    : eq(questLogs.userId, userId);

  return db.query.questLogs.findMany({
    where,
    orderBy: [desc(questLogs.completedAt)],
    limit,
  });
}
