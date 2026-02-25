import { z } from "zod";

import { entityIdSchema, metadataSchema, timestampSchema } from "./common";

export const trustLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const trustLevelNameSchema = z.enum(["watcher", "advisor", "scribe", "agent", "sovereign"]);

export const trustCapabilitySchema = z.enum([
  "observe-signals",
  "suggest-quests",
  "auto-log",
  "modify-schedule",
  "automate-forge",
]);

export const trustOutcomeSchema = z.enum(["accepted", "rejected", "neutral"]);

export const trustEventSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    level: trustLevelSchema,
    action: z.string().min(1).max(128),
    outcome: trustOutcomeSchema,
    trustDelta: z.number().int().min(-100).max(100),
    metadata: metadataSchema.default({}),
    createdAt: timestampSchema,
  })
  .strict();

export const trustStateSchema = z
  .object({
    userId: entityIdSchema,
    level: trustLevelSchema,
    score: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
  })
  .strict();

export type TrustLevel = z.infer<typeof trustLevelSchema>;
export type TrustLevelName = z.infer<typeof trustLevelNameSchema>;
export type TrustCapability = z.infer<typeof trustCapabilitySchema>;
export type TrustEvent = z.infer<typeof trustEventSchema>;
export type TrustState = z.infer<typeof trustStateSchema>;
