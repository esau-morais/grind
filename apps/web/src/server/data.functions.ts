import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import {
  getUserById,
  listQuestsByUser,
  listSkillsByUser,
  getCompanionByUserId,
  listForgeRulesByUser,
  listRecentForgeRunsByUser,
  setForgeRuleEnabled,
} from "@grindxp/core/vault";
import { appendPromptHistory, getPromptHistory, listConversations } from "@grindxp/core/agent";
import type { Objective } from "@grindxp/core";
import { getVaultContext } from "./vault.server";

export const SIDEBAR_COOKIE = "grind@sidebar_open";

export const getSidebarPref = createServerFn({ method: "GET" }).handler((): boolean => {
  const val = getCookie(SIDEBAR_COOKIE);
  return val !== "false"; // default open
});

// Serializable POJO types (no Record<string, unknown> metadata)

export interface SimpleObjective {
  id: string;
  label: string;
  completed: boolean;
  xpReward: number;
}

export interface SimpleQuest {
  id: string;
  title: string;
  type: string;
  difficulty: string;
  status: string;
  objectives: SimpleObjective[];
  skillTags: string[];
  streakCount: number;
  baseXp: number;
  completedAt?: number;
  deadlineAt?: number;
}

export interface SimpleSkill {
  id: string;
  name: string;
  category: string;
  xp: number;
  level: number;
  parentId?: string;
}

export interface ActivityItem {
  id: string;
  questId: string;
  questTitle: string;
  completedAt: number;
  xpEarned: number;
  proofType: string;
  durationMinutes: number | null;
  streakDay: number;
}

export interface DashboardData {
  user: {
    id: string;
    displayName: string;
    level: number;
    totalXp: number;
  };
  xpToday: number;
  bestStreak: number;
  questsCompletedTotal: number;
  activeQuests: SimpleQuest[];
  topSkills: SimpleSkill[];
  recentActivity: ActivityItem[];
}

function toSimpleObjectives(objectives: Objective[]): SimpleObjective[] {
  return objectives.map((o) => ({
    id: o.id,
    label: o.label,
    completed: o.completed,
    xpReward: o.xpReward,
  }));
}

export const getDashboardData = createServerFn({ method: "GET" }).handler(async () => {
  const { db, userId } = getVaultContext();

  const user = await getUserById(db, userId);
  if (!user) throw new Error("User not found");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();

  const [recentLogsRaw, todayLogsRaw, totalLogsRaw, activeQuestsRaw, allSkillsRaw] =
    await Promise.all([
      db.query.questLogs.findMany({
        where: (ql, { eq }) => eq(ql.userId, userId),
        orderBy: (ql, { desc }) => [desc(ql.completedAt)],
        limit: 10,
        with: { quest: { columns: { title: true } } },
      }),
      db.query.questLogs.findMany({
        where: (ql, { eq, and, gte }) => and(eq(ql.userId, userId), gte(ql.completedAt, todayTs)),
        columns: { xpEarned: true },
      }),
      db.query.questLogs.findMany({
        where: (ql, { eq }) => eq(ql.userId, userId),
        columns: { id: true },
      }),
      listQuestsByUser(db, userId, ["active"]),
      listSkillsByUser(db, userId),
    ]);

  const xpToday = todayLogsRaw.reduce((sum, log) => sum + log.xpEarned, 0);
  const bestStreak = activeQuestsRaw.reduce((max, q) => Math.max(max, q.streakCount), 0);

  const activeQuests: SimpleQuest[] = activeQuestsRaw.map((q) => ({
    id: q.id,
    title: q.title,
    type: q.type,
    difficulty: q.difficulty,
    status: q.status,
    objectives: toSimpleObjectives(q.objectives),
    skillTags: q.skillTags,
    streakCount: q.streakCount,
    baseXp: q.baseXp,
    ...(q.completedAt !== undefined ? { completedAt: q.completedAt } : {}),
    ...(q.deadlineAt !== undefined ? { deadlineAt: q.deadlineAt } : {}),
  }));

  const topSkills: SimpleSkill[] = allSkillsRaw
    .slice()
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 6)
    .map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      xp: s.xp,
      level: s.level,
      ...(s.parentId !== undefined ? { parentId: s.parentId } : {}),
    }));

  const recentActivity: ActivityItem[] = recentLogsRaw.map((log) => ({
    id: log.id,
    questId: log.questId,
    questTitle: log.quest?.title ?? "Quest",
    completedAt: log.completedAt,
    xpEarned: log.xpEarned,
    proofType: log.proofType,
    durationMinutes: log.durationMinutes ?? null,
    streakDay: log.streakDay,
  }));

  const result: DashboardData = {
    user: {
      id: user.id,
      displayName: user.displayName,
      level: user.level,
      totalXp: user.totalXp,
    },
    xpToday,
    bestStreak,
    questsCompletedTotal: totalLogsRaw.length,
    activeQuests,
    topSkills,
    recentActivity,
  };

  return result;
});

export interface ConversationItem {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

export const getConversations = createServerFn({ method: "GET" }).handler(async () => {
  const { db, userId } = getVaultContext();
  const convs = await listConversations(db, userId, 30);
  const result: ConversationItem[] = convs.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
  return result;
});

export interface StoredMessageItem {
  id: string;
  role: string;
  content: string;
  toolCallsJson: string | null;
  toolResultsJson: string | null;
  attachments: Array<{ mime: string; base64: string }> | null;
  createdAt: number;
}

function validateLoadConvInput(data: unknown): { conversationId: string } {
  if (typeof data !== "object" || data === null) throw new Error("Invalid input");
  const raw = data as Record<string, unknown>;
  const conversationId = raw["conversationId"];
  if (typeof conversationId !== "string") throw new Error("conversationId is required");
  return { conversationId };
}

export const loadConversationMessages = createServerFn({ method: "POST" })
  .inputValidator(validateLoadConvInput)
  .handler(async ({ data }): Promise<StoredMessageItem[]> => {
    const { db, userId } = getVaultContext();

    const conv = await db.query.conversations.findFirst({
      where: (c, { eq, and }) => and(eq(c.id, data.conversationId), eq(c.userId, userId)),
    });
    if (!conv) return [];

    const msgs = await db.query.messages.findMany({
      where: (m, { eq }) => eq(m.conversationId, data.conversationId),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
      limit: 100,
    });

    return msgs.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCallsJson: m.toolCalls != null ? JSON.stringify(m.toolCalls) : null,
      toolResultsJson: m.toolResults != null ? JSON.stringify(m.toolResults) : null,
      attachments: (m.attachments as Array<{ mime: string; base64: string }> | null) ?? null,
      createdAt: m.createdAt,
    }));
  });

export interface CompanionInfo {
  name: string | null;
  emoji: string | null;
}

export const getCompanionInfo = createServerFn({ method: "GET" }).handler(
  async (): Promise<CompanionInfo> => {
    const { db, userId } = getVaultContext();
    const row = await getCompanionByUserId(db, userId);
    return { name: row?.name ?? null, emoji: row?.emoji ?? null };
  },
);

export const getPromptHistoryEntries = createServerFn({ method: "GET" }).handler(
  async (): Promise<string[]> => {
    const { db, userId } = getVaultContext();
    return getPromptHistory(db, userId);
  },
);

function validateAppendPromptInput(data: unknown): { content: string } {
  if (typeof data !== "object" || data === null) throw new Error("Invalid input");
  const raw = data as Record<string, unknown>;
  const content = raw["content"];
  if (typeof content !== "string" || !content.trim()) throw new Error("content is required");
  return { content: content.trim() };
}

export const appendPromptHistoryEntry = createServerFn({ method: "POST" })
  .inputValidator(validateAppendPromptInput)
  .handler(async ({ data }): Promise<void> => {
    const { db, userId } = getVaultContext();
    await appendPromptHistory(db, userId, data.content);
  });

// ─── Forge page ──────────────────────────────────────────────────────────────

export interface SimpleForgeRuleData {
  id: string;
  name: string;
  triggerType: string;
  triggerConfig: Record<string, string | number | boolean | null>;
  actionType: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SimpleForgeRunData {
  id: string;
  ruleId: string;
  ruleName: string;
  triggerType: string;
  actionType: string;
  status: string;
  startedAt: number;
  finishedAt: number;
  error: string | null;
}

export interface ForgePageData {
  rules: SimpleForgeRuleData[];
  recentRuns: SimpleForgeRunData[];
}

export const getForgePageData = createServerFn({ method: "GET" }).handler(
  async (): Promise<ForgePageData> => {
    const { db, userId } = getVaultContext();
    const [rules, runs] = await Promise.all([
      listForgeRulesByUser(db, userId),
      listRecentForgeRunsByUser(db, userId, 30),
    ]);

    return {
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        triggerType: r.triggerType,
        triggerConfig: r.triggerConfig as Record<string, string | number | boolean | null>,
        actionType: r.actionType,
        enabled: r.enabled,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      recentRuns: runs.map((r) => ({
        id: r.id,
        ruleId: r.ruleId,
        ruleName: rules.find((rule) => rule.id === r.ruleId)?.name ?? r.ruleId,
        triggerType: r.triggerType,
        actionType: r.actionType,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        error: r.error ?? null,
      })),
    };
  },
);

function validateToggleForgeRuleInput(data: unknown): { ruleId: string; enabled: boolean } {
  if (typeof data !== "object" || data === null) throw new Error("Invalid input");
  const raw = data as Record<string, unknown>;
  const ruleId = raw["ruleId"];
  const enabled = raw["enabled"];
  if (typeof ruleId !== "string") throw new Error("ruleId is required");
  if (typeof enabled !== "boolean") throw new Error("enabled is required");
  return { ruleId, enabled };
}

export const toggleForgeRuleFn = createServerFn({ method: "POST" })
  .inputValidator(validateToggleForgeRuleInput)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { db } = getVaultContext();
    await setForgeRuleEnabled(db, data.ruleId, data.enabled);
    return { ok: true };
  });
