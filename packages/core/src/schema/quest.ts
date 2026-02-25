import { z } from "zod";

import { clockTimeSchema, entityIdSchema, metadataSchema, timestampSchema } from "./common";

export const questTypes = ["daily", "weekly", "epic", "bounty", "chain", "ritual"] as const;

export const questTypeSchema = z.enum(questTypes);

export const questDifficulties = ["easy", "medium", "hard", "epic"] as const;

export const questDifficultySchema = z.enum(questDifficulties);

export const questStatusSchema = z.enum([
  "available",
  "active",
  "completed",
  "failed",
  "abandoned",
]);

export const objectiveSchema = z
  .object({
    id: entityIdSchema,
    label: z.string().min(1).max(256),
    completed: z.boolean().default(false),
    xpReward: z.number().int().nonnegative().default(0),
  })
  .strict();

export const questScheduleSchema = z
  .object({
    cron: z.string().min(1).max(128).optional(),
    windowStart: clockTimeSchema.optional(),
    windowEnd: clockTimeSchema.optional(),
    timezone: z.string().min(1).max(64).default("UTC"),
  })
  .strict();

export const questSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    title: z.string().min(1).max(256),
    description: z.string().max(2000).optional(),
    type: questTypeSchema,
    difficulty: questDifficultySchema,
    status: questStatusSchema.default("available"),
    objectives: z.array(objectiveSchema).default([]),
    skillTags: z.array(z.string().min(1).max(128)).default([]),
    schedule: questScheduleSchema.optional(),
    parentId: entityIdSchema.optional(),
    streakCount: z.number().int().nonnegative().default(0),
    baseXp: z.number().int().positive().default(10),
    metadata: metadataSchema.default({}),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.optional(),
    deadlineAt: timestampSchema.optional(),
  })
  .strict();

export const createQuestInputSchema = questSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    completedAt: true,
    status: true,
    streakCount: true,
  })
  .extend({
    status: questStatusSchema.optional(),
    streakCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const updateQuestStatusInputSchema = z
  .object({
    questId: entityIdSchema,
    from: questStatusSchema,
    to: questStatusSchema,
    reason: z.string().max(500).optional(),
    at: timestampSchema,
  })
  .strict();

export type QuestType = z.infer<typeof questTypeSchema>;
export type QuestDifficulty = z.infer<typeof questDifficultySchema>;
export type QuestStatus = z.infer<typeof questStatusSchema>;
export type Objective = z.infer<typeof objectiveSchema>;
export type Quest = z.infer<typeof questSchema>;
export type CreateQuestInput = z.infer<typeof createQuestInputSchema>;
export type UpdateQuestStatusInput = z.infer<typeof updateQuestStatusInputSchema>;
