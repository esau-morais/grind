import { and, desc, eq, sql } from "drizzle-orm";

import type {
  CreateForgeRuleInput,
  CreateForgeRunInput,
  CreateSignalInput,
  ForgeActionType,
  ForgeRule,
  ForgeTriggerType,
  ForgeRun,
  Signal,
  SignalSource,
} from "../../schema";
import {
  createForgeRuleInputSchema,
  createForgeRunInputSchema,
  createSignalInputSchema,
  forgeRuleSchema,
  forgeRunSchema,
  signalSchema,
} from "../../schema";
import { forgeRules, forgeRuns, signals } from "../schema";
import type { VaultDb } from "../types";

function rowToForgeRule(row: typeof forgeRules.$inferSelect): ForgeRule {
  return forgeRuleSchema.parse({
    id: row.id,
    userId: row.userId,
    name: row.name,
    triggerType: row.triggerType,
    triggerConfig: row.triggerConfig,
    actionType: row.actionType,
    actionConfig: row.actionConfig,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function rowToSignal(row: typeof signals.$inferSelect): Signal {
  return signalSchema.parse({
    id: row.id,
    userId: row.userId,
    source: row.source,
    type: row.type,
    confidence: row.confidence,
    payload: row.payload,
    detectedAt: row.detectedAt,
    ingestedAt: row.ingestedAt,
  });
}

function rowToForgeRun(row: typeof forgeRuns.$inferSelect): ForgeRun {
  return forgeRunSchema.parse({
    id: row.id,
    userId: row.userId,
    ruleId: row.ruleId,
    triggerType: row.triggerType,
    triggerPayload: row.triggerPayload,
    actionType: row.actionType,
    actionPayload: row.actionPayload,
    status: row.status,
    dedupeKey: row.dedupeKey,
    ...(row.error ? { error: row.error } : {}),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  });
}

export async function insertForgeRule(
  db: VaultDb,
  input: CreateForgeRuleInput,
): Promise<ForgeRule> {
  const valid = createForgeRuleInputSchema.parse(input);
  const [row] = await db.insert(forgeRules).values(valid).returning();
  if (!row) throw new Error("Failed to insert forge rule");
  return rowToForgeRule(row);
}

export async function listForgeRulesByUser(
  db: VaultDb,
  userId: string,
  options?: { enabledOnly?: boolean },
): Promise<ForgeRule[]> {
  const where = options?.enabledOnly
    ? and(eq(forgeRules.userId, userId), eq(forgeRules.enabled, true))
    : eq(forgeRules.userId, userId);

  const rows = await db.query.forgeRules.findMany({
    where,
    orderBy: [desc(forgeRules.updatedAt)],
  });

  return rows.map(rowToForgeRule);
}

export async function getForgeRuleById(db: VaultDb, ruleId: string): Promise<ForgeRule | null> {
  const row = await db.query.forgeRules.findFirst({ where: eq(forgeRules.id, ruleId) });
  if (!row) return null;
  return rowToForgeRule(row);
}

export async function findForgeRuleByPrefix(
  db: VaultDb,
  userId: string,
  prefix: string,
): Promise<ForgeRule | null> {
  const rows = await db.query.forgeRules.findMany({
    where: eq(forgeRules.userId, userId),
    orderBy: [desc(forgeRules.updatedAt)],
  });

  const lowerPrefix = prefix.toLowerCase();
  const match = rows.find(
    (r) => r.id.startsWith(prefix) || r.name.toLowerCase().includes(lowerPrefix),
  );
  return match ? rowToForgeRule(match) : null;
}

export async function setForgeRuleEnabled(
  db: VaultDb,
  ruleId: string,
  enabled: boolean,
): Promise<ForgeRule | null> {
  const [row] = await db
    .update(forgeRules)
    .set({ enabled, updatedAt: Date.now() })
    .where(eq(forgeRules.id, ruleId))
    .returning();
  return row ? rowToForgeRule(row) : null;
}

export interface UpdateForgeRulePatch {
  name?: string;
  triggerType?: ForgeTriggerType;
  triggerConfig?: Record<string, unknown>;
  actionType?: ForgeActionType;
  actionConfig?: Record<string, unknown>;
  enabled?: boolean;
}

export async function updateForgeRule(
  db: VaultDb,
  userId: string,
  ruleId: string,
  patch: UpdateForgeRulePatch,
): Promise<ForgeRule | null> {
  const existing = await db.query.forgeRules.findFirst({
    where: and(eq(forgeRules.id, ruleId), eq(forgeRules.userId, userId)),
  });
  if (!existing) return null;

  const nextRule = forgeRuleSchema.parse({
    id: existing.id,
    userId: existing.userId,
    name: patch.name ?? existing.name,
    triggerType: patch.triggerType ?? existing.triggerType,
    triggerConfig: patch.triggerConfig ?? existing.triggerConfig,
    actionType: patch.actionType ?? existing.actionType,
    actionConfig: patch.actionConfig ?? existing.actionConfig,
    enabled: patch.enabled ?? existing.enabled,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  });

  const [row] = await db
    .update(forgeRules)
    .set({
      name: nextRule.name,
      triggerType: nextRule.triggerType,
      triggerConfig: nextRule.triggerConfig,
      actionType: nextRule.actionType,
      actionConfig: nextRule.actionConfig,
      enabled: nextRule.enabled,
      updatedAt: nextRule.updatedAt,
    })
    .where(and(eq(forgeRules.id, ruleId), eq(forgeRules.userId, userId)))
    .returning();

  return row ? rowToForgeRule(row) : null;
}

export async function deleteForgeRule(
  db: VaultDb,
  userId: string,
  ruleId: string,
): Promise<boolean> {
  const rows = await db
    .delete(forgeRules)
    .where(and(eq(forgeRules.id, ruleId), eq(forgeRules.userId, userId)))
    .returning({ id: forgeRules.id });

  return rows.length > 0;
}

export async function listSignals(
  db: VaultDb,
  userId: string,
  options: { limit?: number; source?: SignalSource } = {},
): Promise<Signal[]> {
  const { limit = 20, source } = options;
  const where = source
    ? and(eq(signals.userId, userId), eq(signals.source, source))
    : eq(signals.userId, userId);
  const rows = await db.query.signals.findMany({
    where,
    orderBy: [desc(signals.detectedAt)],
    limit,
  });
  return rows.map(rowToSignal);
}

export async function recordSignal(db: VaultDb, input: CreateSignalInput): Promise<Signal> {
  const valid = createSignalInputSchema.parse(input);
  const [row] = await db.insert(signals).values(valid).returning();
  if (!row) throw new Error("Failed to record signal");
  return rowToSignal(row);
}

export async function getLatestSignalBySource(
  db: VaultDb,
  userId: string,
  source: SignalSource,
): Promise<Signal | null> {
  const row = await db.query.signals.findFirst({
    where: and(eq(signals.userId, userId), eq(signals.source, source)),
    orderBy: [desc(signals.detectedAt)],
  });
  return row ? rowToSignal(row) : null;
}

export async function getLatestSignalByFingerprint(
  db: VaultDb,
  userId: string,
  source: SignalSource,
  fingerprint: string,
): Promise<Signal | null> {
  const rows = await db.query.signals.findMany({
    where: and(eq(signals.userId, userId), eq(signals.source, source)),
    orderBy: [desc(signals.detectedAt)],
    limit: 200,
  });

  const row = rows.find((entry) => {
    const entryFingerprint =
      typeof entry.payload === "object" && entry.payload !== null
        ? (entry.payload as Record<string, unknown>).fingerprint
        : null;
    return entryFingerprint === fingerprint;
  });

  return row ? rowToSignal(row) : null;
}

export async function hasForgeRunByDedupe(
  db: VaultDb,
  ruleId: string,
  dedupeKey: string,
): Promise<boolean> {
  const rows = await db
    .select({ value: sql<number>`count(1)` })
    .from(forgeRuns)
    .where(and(eq(forgeRuns.ruleId, ruleId), eq(forgeRuns.dedupeKey, dedupeKey)));

  const count = rows[0]?.value ?? 0;
  return count > 0;
}

export async function recordForgeRun(
  db: VaultDb,
  input: CreateForgeRunInput,
): Promise<ForgeRun | null> {
  const valid = createForgeRunInputSchema.parse(input);

  const rows = await db
    .insert(forgeRuns)
    .values(valid)
    .onConflictDoNothing({ target: [forgeRuns.ruleId, forgeRuns.dedupeKey] })
    .returning();

  const row = rows[0];
  return row ? rowToForgeRun(row) : null;
}

export async function listRecentForgeRunsByUser(
  db: VaultDb,
  userId: string,
  limit = 20,
): Promise<ForgeRun[]> {
  const rows = await db.query.forgeRuns.findMany({
    where: eq(forgeRuns.userId, userId),
    orderBy: [desc(forgeRuns.startedAt)],
    limit,
  });

  return rows.map(rowToForgeRun);
}

export async function listForgeRunsByRule(
  db: VaultDb,
  userId: string,
  ruleId: string,
  limit = 20,
): Promise<ForgeRun[]> {
  const rows = await db.query.forgeRuns.findMany({
    where: and(eq(forgeRuns.userId, userId), eq(forgeRuns.ruleId, ruleId)),
    orderBy: [desc(forgeRuns.startedAt)],
    limit,
  });

  return rows.map(rowToForgeRun);
}
