import { z } from "zod";

import { entityIdSchema, metadataSchema, timestampSchema } from "./common";
import { trustLevelSchema } from "./trust";

export const companionProviderSchema = z.enum(["anthropic", "openai", "google", "ollama"]);

export const companionModeSchema = z.enum(["off", "suggest", "assist", "auto"]);

export const companionSettingsSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    name: z.string().max(64).nullish(),
    emoji: z.string().max(8).nullish(),
    mode: companionModeSchema.default("suggest"),
    trustLevel: trustLevelSchema,
    trustScore: z.number().int().nonnegative(),
    provider: companionProviderSchema,
    model: z.string().min(1).max(128),
    systemPrompt: z.string().nullish(),
    userContext: z.string().nullish(),
    config: metadataSchema.default({}),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const createCompanionSettingsInputSchema = companionSettingsSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    trustLevel: true,
    trustScore: true,
  })
  .extend({
    trustLevel: trustLevelSchema.optional(),
    trustScore: z.number().int().nonnegative().optional(),
  })
  .strict();

export type CompanionProvider = z.infer<typeof companionProviderSchema>;
export type CompanionMode = z.infer<typeof companionModeSchema>;
export type CompanionSettings = z.infer<typeof companionSettingsSchema>;
export type CreateCompanionSettingsInput = z.infer<typeof createCompanionSettingsInputSchema>;
