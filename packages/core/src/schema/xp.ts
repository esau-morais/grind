import { z } from "zod";

import { entityIdSchema } from "./common";

export const activityTypeSchema = z.enum([
  "workout",
  "study",
  "coding",
  "music",
  "cooking",
  "reading",
  "meditation",
  "other",
]);

export const xpEventSchema = z
  .object({
    questId: entityIdSchema,
    baseXp: z.number().int().positive(),
    streakDays: z.number().int().nonnegative().default(0),
    proofMultiplier: z.number().min(1).max(2).default(1),
    totalXp: z.number().int().nonnegative(),
  })
  .strict();

export type ActivityType = z.infer<typeof activityTypeSchema>;
export type XpEvent = z.infer<typeof xpEventSchema>;
