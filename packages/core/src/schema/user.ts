import { z } from "zod";

import { entityIdSchema, metadataSchema, timestampSchema } from "./common";

export const userPreferencesSchema = z
  .object({
    timezone: z.string().min(1).max(64).default("UTC"),
    locale: z.string().min(2).max(16).default("en-US"),
    notificationsEnabled: z.boolean().default(true),
    companionEnabled: z.boolean().default(false),
    preferredModel: z.string().max(128).optional(),
  })
  .strict();

export const userProfileSchema = z
  .object({
    id: entityIdSchema,
    displayName: z.string().min(1).max(128),
    level: z.number().int().positive().default(1),
    totalXp: z.number().int().nonnegative().default(0),
    preferences: userPreferencesSchema,
    metadata: metadataSchema.default({}),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const createUserProfileInputSchema = z
  .object({
    id: entityIdSchema.optional(),
    displayName: z.string().min(1).max(128),
    level: z.number().int().positive().default(1),
    totalXp: z.number().int().nonnegative().default(0),
    preferences: userPreferencesSchema.default({}),
    metadata: metadataSchema.default({}),
  })
  .strict();

export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type CreateUserProfileInput = z.infer<typeof createUserProfileInputSchema>;
