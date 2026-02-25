import { relations } from "drizzle-orm";

import {
  companionInsights,
  companionSettings,
  conversations,
  forgeRules,
  forgeRuns,
  messages,
  promptHistory,
  proofs,
  questLogs,
  quests,
  rituals,
  signals,
  skills,
  trustLog,
  users,
} from "./schema";

export const usersRelations = relations(users, ({ many, one }) => ({
  quests: many(quests),
  questLogs: many(questLogs),
  skills: many(skills),
  rituals: many(rituals),
  signals: many(signals),
  forgeRules: many(forgeRules),
  forgeRuns: many(forgeRuns),
  trustLogEntries: many(trustLog),
  companionSettings: one(companionSettings),
  companionInsights: many(companionInsights),
  conversations: many(conversations),
  promptHistory: many(promptHistory),
}));

export const questsRelations = relations(quests, ({ one, many }) => ({
  user: one(users, { fields: [quests.userId], references: [users.id] }),
  parent: one(quests, {
    fields: [quests.parentId],
    references: [quests.id],
    relationName: "quest_parent",
  }),
  children: many(quests, { relationName: "quest_parent" }),
  logs: many(questLogs),
}));

export const questLogsRelations = relations(questLogs, ({ one, many }) => ({
  quest: one(quests, { fields: [questLogs.questId], references: [quests.id] }),
  user: one(users, { fields: [questLogs.userId], references: [users.id] }),
  proofs: many(proofs),
}));

export const proofsRelations = relations(proofs, ({ one }) => ({
  questLog: one(questLogs, { fields: [proofs.questLogId], references: [questLogs.id] }),
}));

export const skillsRelations = relations(skills, ({ one, many }) => ({
  user: one(users, { fields: [skills.userId], references: [users.id] }),
  parent: one(skills, {
    fields: [skills.parentId],
    references: [skills.id],
    relationName: "skill_parent",
  }),
  children: many(skills, { relationName: "skill_parent" }),
}));

export const ritualsRelations = relations(rituals, ({ one }) => ({
  user: one(users, { fields: [rituals.userId], references: [users.id] }),
}));

export const signalsRelations = relations(signals, ({ one }) => ({
  user: one(users, { fields: [signals.userId], references: [users.id] }),
}));

export const forgeRulesRelations = relations(forgeRules, ({ one, many }) => ({
  user: one(users, { fields: [forgeRules.userId], references: [users.id] }),
  runs: many(forgeRuns),
}));

export const forgeRunsRelations = relations(forgeRuns, ({ one }) => ({
  user: one(users, { fields: [forgeRuns.userId], references: [users.id] }),
  rule: one(forgeRules, { fields: [forgeRuns.ruleId], references: [forgeRules.id] }),
}));

export const trustLogRelations = relations(trustLog, ({ one }) => ({
  user: one(users, { fields: [trustLog.userId], references: [users.id] }),
}));

export const companionSettingsRelations = relations(companionSettings, ({ one }) => ({
  user: one(users, { fields: [companionSettings.userId], references: [users.id] }),
}));

export const companionInsightsRelations = relations(companionInsights, ({ one }) => ({
  user: one(users, { fields: [companionInsights.userId], references: [users.id] }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const promptHistoryRelations = relations(promptHistory, ({ one }) => ({
  user: one(users, { fields: [promptHistory.userId], references: [users.id] }),
}));
