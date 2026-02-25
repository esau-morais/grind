import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { Objective } from "../schema";

type Metadata = Record<string, unknown>;

const idColumn = (name = "id") =>
  text(name)
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAtColumn = (name = "created_at") =>
  integer(name)
    .notNull()
    .$defaultFn(() => Date.now());

const updatedAtColumn = (name = "updated_at") =>
  integer(name)
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdate(() => Date.now());

export const users = sqliteTable("users", {
  id: idColumn(),
  displayName: text("display_name").notNull(),
  level: integer("level").notNull().default(1),
  totalXp: integer("total_xp").notNull().default(0),
  timezone: text("timezone").notNull().default("UTC"),
  locale: text("locale").notNull().default("en-US"),
  notificationsEnabled: integer("notifications_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  companionEnabled: integer("companion_enabled", { mode: "boolean" }).notNull().default(false),
  preferredModel: text("preferred_model"),
  metadata: text("metadata", { mode: "json" }).$type<Metadata>().notNull().default({}),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const quests = sqliteTable(
  "quests",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => quests.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    type: text("type").notNull(),
    difficulty: text("difficulty").notNull(),
    status: text("status").notNull().default("available"),
    objectives: text("objectives", { mode: "json" }).$type<Objective[]>().notNull().default([]),
    skillTags: text("skill_tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    scheduleCron: text("schedule_cron"),
    streakCount: integer("streak_count").notNull().default(0),
    baseXp: integer("base_xp").notNull().default(10),
    metadata: text("metadata", { mode: "json" }).$type<Metadata>().notNull().default({}),
    deadlineAt: integer("deadline_at"),
    completedAt: integer("completed_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("quests_user_status_idx").on(table.userId, table.status),
    index("quests_user_updated_idx").on(table.userId, table.updatedAt),
    index("quests_status_deadline_idx").on(table.status, table.deadlineAt),
    index("quests_parent_idx").on(table.parentId),
    index("quests_user_title_idx").on(table.userId, table.title),
  ],
);

export const questLogs = sqliteTable(
  "quest_logs",
  {
    id: idColumn(),
    questId: text("quest_id")
      .notNull()
      .references(() => quests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    completedAt: integer("completed_at").notNull(),
    durationMinutes: integer("duration_minutes"),
    xpEarned: integer("xp_earned").notNull(),
    proofType: text("proof_type").notNull(),
    proofData: text("proof_data", { mode: "json" }).$type<Metadata>().notNull().default({}),
    streakDay: integer("streak_day").notNull().default(0),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("quest_logs_quest_completed_idx").on(table.questId, table.completedAt),
    index("quest_logs_user_completed_idx").on(table.userId, table.completedAt),
  ],
);

export const proofs = sqliteTable(
  "proofs",
  {
    id: idColumn(),
    questLogId: text("quest_log_id")
      .notNull()
      .references(() => questLogs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    confidence: real("confidence"),
    data: text("data", { mode: "json" }).$type<Metadata>().notNull().default({}),
    createdAt: createdAtColumn(),
  },
  (table) => [index("proofs_quest_log_idx").on(table.questLogId)],
);

export const skills = sqliteTable(
  "skills",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => skills.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    xp: integer("xp").notNull().default(0),
    level: integer("level").notNull().default(0),
    metadata: text("metadata", { mode: "json" }).$type<Metadata>().notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("skills_user_name_idx").on(table.userId, table.name),
    index("skills_parent_idx").on(table.parentId),
    index("skills_user_category_idx").on(table.userId, table.category),
  ],
);

export const rituals = sqliteTable(
  "rituals",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    frequency: text("frequency").notNull(),
    state: text("state").notNull().default("active"),
    scheduleCron: text("schedule_cron"),
    windowStart: text("window_start"),
    windowEnd: text("window_end"),
    streakCurrent: integer("streak_current").notNull().default(0),
    streakBest: integer("streak_best").notNull().default(0),
    metadata: text("metadata", { mode: "json" }).$type<Metadata>().notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    completedAt: integer("completed_at"),
  },
  (table) => [index("rituals_user_state_idx").on(table.userId, table.state)],
);

export const signals = sqliteTable(
  "signals",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    type: text("type").notNull(),
    confidence: real("confidence").notNull(),
    payload: text("payload", { mode: "json" }).$type<Metadata>().notNull().default({}),
    detectedAt: integer("detected_at").notNull(),
    ingestedAt: createdAtColumn("ingested_at"),
  },
  (table) => [index("signals_user_detected_idx").on(table.userId, table.detectedAt)],
);

export const forgeRules = sqliteTable(
  "forge_rules",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    triggerType: text("trigger_type").notNull(),
    triggerConfig: text("trigger_config", { mode: "json" }).$type<Metadata>().notNull().default({}),
    actionType: text("action_type").notNull(),
    actionConfig: text("action_config", { mode: "json" }).$type<Metadata>().notNull().default({}),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index("forge_rules_user_enabled_idx").on(table.userId, table.enabled)],
);

export const forgeRuns = sqliteTable(
  "forge_runs",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => forgeRules.id, { onDelete: "cascade" }),
    triggerType: text("trigger_type").notNull(),
    triggerPayload: text("trigger_payload", { mode: "json" })
      .$type<Metadata>()
      .notNull()
      .default({}),
    actionType: text("action_type").notNull(),
    actionPayload: text("action_payload", { mode: "json" }).$type<Metadata>().notNull().default({}),
    status: text("status").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    error: text("error"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("forge_runs_user_started_idx").on(table.userId, table.startedAt),
    index("forge_runs_rule_started_idx").on(table.ruleId, table.startedAt),
    uniqueIndex("forge_runs_rule_dedupe_idx").on(table.ruleId, table.dedupeKey),
  ],
);

export const trustLog = sqliteTable(
  "trust_log",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    trustDelta: integer("trust_delta").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Metadata>().notNull().default({}),
    createdAt: createdAtColumn(),
  },
  (table) => [index("trust_log_user_created_idx").on(table.userId, table.createdAt)],
);

export const companionSettings = sqliteTable(
  "companion_settings",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name"),
    emoji: text("emoji"),
    mode: text("mode").notNull().default("suggest"),
    trustLevel: integer("trust_level").notNull().default(0),
    trustScore: integer("trust_score").notNull().default(0),
    provider: text("provider").notNull().default("anthropic"),
    model: text("model").notNull().default("claude-3-5-haiku-latest"),
    systemPrompt: text("system_prompt"),
    userContext: text("user_context"),
    config: text("config", { mode: "json" }).$type<Metadata>().notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [uniqueIndex("companion_settings_user_idx").on(table.userId)],
);

export const companionInsights = sqliteTable(
  "companion_insights",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    content: text("content").notNull(),
    confidence: real("confidence").notNull().default(0.7),
    source: text("source").notNull().default("ai-observed"),
    metadata: text("metadata", { mode: "json" }).$type<Metadata>().notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("companion_insights_user_updated_idx").on(table.userId, table.updatedAt),
    index("companion_insights_user_category_idx").on(table.userId, table.category),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export type QuestRow = typeof quests.$inferSelect;
export type NewQuestRow = typeof quests.$inferInsert;

export type QuestLogRow = typeof questLogs.$inferSelect;
export type NewQuestLogRow = typeof questLogs.$inferInsert;

export type SkillRow = typeof skills.$inferSelect;
export type NewSkillRow = typeof skills.$inferInsert;

export type ForgeRuleRow = typeof forgeRules.$inferSelect;
export type NewForgeRuleRow = typeof forgeRules.$inferInsert;

export type ForgeRunRow = typeof forgeRuns.$inferSelect;
export type NewForgeRunRow = typeof forgeRuns.$inferInsert;

export const conversations = sqliteTable(
  "conversations",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index("conversations_user_updated_idx").on(table.userId, table.updatedAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: idColumn(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolCalls: text("tool_calls", { mode: "json" }).$type<unknown[]>(),
    toolResults: text("tool_results", { mode: "json" }).$type<unknown[]>(),
    attachments: text("attachments", { mode: "json" }).$type<
      Array<{ mime: string; base64: string }>
    >(),
    createdAt: createdAtColumn(),
  },
  (table) => [index("messages_conversation_idx").on(table.conversationId, table.createdAt)],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

export const promptHistory = sqliteTable(
  "prompt_history",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [index("prompt_history_user_created_idx").on(table.userId, table.createdAt)],
);

export type PromptHistoryRow = typeof promptHistory.$inferSelect;
export type NewPromptHistoryRow = typeof promptHistory.$inferInsert;

export type CompanionSettingsRow = typeof companionSettings.$inferSelect;
export type NewCompanionSettingsRow = typeof companionSettings.$inferInsert;

export type CompanionInsightRow = typeof companionInsights.$inferSelect;
export type NewCompanionInsightRow = typeof companionInsights.$inferInsert;

export type TrustLogRow = typeof trustLog.$inferSelect;
export type NewTrustLogRow = typeof trustLog.$inferInsert;
