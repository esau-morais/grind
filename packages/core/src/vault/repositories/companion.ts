import { and, asc, desc, eq, sql } from "drizzle-orm";

import type {
  CompanionInsightRow,
  CompanionSettingsRow,
  NewCompanionInsightRow,
  NewCompanionSettingsRow,
} from "../schema";
import { companionInsights, companionSettings } from "../schema";
import type { VaultDb } from "../types";

export async function getCompanionByUserId(
  db: VaultDb,
  userId: string,
): Promise<CompanionSettingsRow | null> {
  const row = await db.query.companionSettings.findFirst({
    where: eq(companionSettings.userId, userId),
  });
  return row ?? null;
}

export async function upsertCompanion(
  db: VaultDb,
  values: NewCompanionSettingsRow,
): Promise<CompanionSettingsRow> {
  const existing = await getCompanionByUserId(db, values.userId);

  if (existing) {
    const [updated] = await db
      .update(companionSettings)
      .set({ ...values, updatedAt: Date.now() })
      .where(eq(companionSettings.id, existing.id))
      .returning();
    if (!updated) throw new Error("Failed to update companion settings");
    return updated;
  }

  const [row] = await db.insert(companionSettings).values(values).returning();
  if (!row) throw new Error("Failed to insert companion settings");
  return row;
}

export async function updateCompanionSoul(
  db: VaultDb,
  userId: string,
  systemPrompt: string,
): Promise<CompanionSettingsRow> {
  const [updated] = await db
    .update(companionSettings)
    .set({ systemPrompt, updatedAt: Date.now() })
    .where(eq(companionSettings.userId, userId))
    .returning();
  if (!updated) throw new Error("Companion not found. Run `grindxp init` first.");
  return updated;
}

export async function updateCompanionUserContext(
  db: VaultDb,
  userId: string,
  userContext: string,
): Promise<CompanionSettingsRow> {
  const [updated] = await db
    .update(companionSettings)
    .set({ userContext, updatedAt: Date.now() })
    .where(eq(companionSettings.userId, userId))
    .returning();
  if (!updated) throw new Error("Companion not found. Run `grindxp init` first.");
  return updated;
}

export async function listCompanionInsights(
  db: VaultDb,
  userId: string,
  limit = 20,
): Promise<CompanionInsightRow[]> {
  return db.query.companionInsights.findMany({
    where: eq(companionInsights.userId, userId),
    orderBy: [
      asc(sql`case when ${companionInsights.source} = 'user-stated' then 0 else 1 end`),
      desc(companionInsights.confidence),
      desc(companionInsights.updatedAt),
    ],
    limit,
  });
}

export async function createCompanionInsight(
  db: VaultDb,
  values: NewCompanionInsightRow,
): Promise<CompanionInsightRow> {
  const [row] = await db.insert(companionInsights).values(values).returning();
  if (!row) throw new Error("Failed to insert companion insight");
  return row;
}

export async function updateCompanionInsight(
  db: VaultDb,
  insightId: string,
  userId: string,
  values: {
    category?: string;
    content?: string;
    confidence?: number;
    source?: string;
  },
): Promise<CompanionInsightRow> {
  const [row] = await db
    .update(companionInsights)
    .set({
      ...(values.category !== undefined ? { category: values.category } : {}),
      ...(values.content !== undefined ? { content: values.content } : {}),
      ...(values.confidence !== undefined ? { confidence: values.confidence } : {}),
      ...(values.source !== undefined ? { source: values.source } : {}),
      updatedAt: Date.now(),
    })
    .where(and(eq(companionInsights.id, insightId), eq(companionInsights.userId, userId)))
    .returning();

  if (!row) throw new Error("Companion insight not found");
  return row;
}

export async function findCompanionInsightByContent(
  db: VaultDb,
  userId: string,
  category: string,
  content: string,
): Promise<CompanionInsightRow | null> {
  const row = await db.query.companionInsights.findFirst({
    where: and(
      eq(companionInsights.userId, userId),
      eq(companionInsights.category, category),
      sql`lower(trim(${companionInsights.content})) = lower(trim(${content}))`,
    ),
  });
  return row ?? null;
}

export async function updateCompanionMode(
  db: VaultDb,
  userId: string,
  mode: string,
): Promise<CompanionSettingsRow> {
  const [updated] = await db
    .update(companionSettings)
    .set({ mode, updatedAt: Date.now() })
    .where(eq(companionSettings.userId, userId))
    .returning();
  if (!updated) throw new Error("Companion not found. Run `grindxp init` first.");
  return updated;
}

export async function deleteCompanionInsight(
  db: VaultDb,
  insightId: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .delete(companionInsights)
    .where(and(eq(companionInsights.id, insightId), eq(companionInsights.userId, userId)))
    .returning({ id: companionInsights.id });
  return row.length > 0;
}
