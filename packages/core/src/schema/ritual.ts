import { z } from "zod";

import { clockTimeSchema, entityIdSchema, metadataSchema, timestampSchema } from "./common";

export const ritualFrequencySchema = z.enum(["daily", "weekly", "monthly", "custom"]);

export const ritualStateSchema = z.enum(["active", "paused", "archived"]);

export const ritualSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    name: z.string().min(1).max(128),
    description: z.string().max(1000).optional(),
    frequency: ritualFrequencySchema,
    state: ritualStateSchema.default("active"),
    scheduleCron: z.string().max(128).optional(),
    windowStart: clockTimeSchema.optional(),
    windowEnd: clockTimeSchema.optional(),
    streakCurrent: z.number().int().nonnegative().default(0),
    streakBest: z.number().int().nonnegative().default(0),
    metadata: metadataSchema.default({}),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    completedAt: timestampSchema.optional(),
  })
  .strict();

export const ritualStreakSchema = z
  .object({
    ritualId: entityIdSchema,
    currentDays: z.number().int().nonnegative(),
    bestDays: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
  })
  .strict();

export type RitualFrequency = z.infer<typeof ritualFrequencySchema>;
export type RitualState = z.infer<typeof ritualStateSchema>;
export type Ritual = z.infer<typeof ritualSchema>;
export type RitualStreak = z.infer<typeof ritualStreakSchema>;
