import { z } from "zod";

import { entityIdSchema, metadataSchema, timestampSchema } from "./common";

export const forgeTriggerTypeSchema = z.enum([
  "cron",
  "event",
  "signal",
  "webhook",
  "companion",
  "manual",
]);

export const forgeActionTypeSchema = z.enum([
  "queue-quest",
  "send-notification",
  "update-skill",
  "run-script",
  "log-to-vault",
  "trigger-companion",
]);

export const forgeActionRiskSchema = z.enum(["low", "medium", "high"]);

export const forgeRunStatusSchema = z.enum(["success", "skipped", "failed"]);

export const forgeRuleSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    name: z.string().min(1).max(128),
    triggerType: forgeTriggerTypeSchema,
    triggerConfig: metadataSchema.default({}),
    actionType: forgeActionTypeSchema,
    actionConfig: metadataSchema.default({}),
    enabled: z.boolean().default(true),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const createForgeRuleInputSchema = forgeRuleSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .strict();

export const forgeRunSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    ruleId: entityIdSchema,
    triggerType: forgeTriggerTypeSchema,
    triggerPayload: metadataSchema.default({}),
    actionType: forgeActionTypeSchema,
    actionPayload: metadataSchema.default({}),
    status: forgeRunStatusSchema,
    dedupeKey: z.string().min(1).max(512),
    error: z.string().max(2000).optional(),
    startedAt: timestampSchema,
    finishedAt: timestampSchema,
    createdAt: timestampSchema,
  })
  .strict();

export const createForgeRunInputSchema = forgeRunSchema
  .omit({
    id: true,
    createdAt: true,
  })
  .strict();

export type ForgeTriggerType = z.infer<typeof forgeTriggerTypeSchema>;
export type ForgeActionType = z.infer<typeof forgeActionTypeSchema>;
export type ForgeActionRisk = z.infer<typeof forgeActionRiskSchema>;
export type ForgeRule = z.infer<typeof forgeRuleSchema>;
export type CreateForgeRuleInput = z.infer<typeof createForgeRuleInputSchema>;
export type ForgeRunStatus = z.infer<typeof forgeRunStatusSchema>;
export type ForgeRun = z.infer<typeof forgeRunSchema>;
export type CreateForgeRunInput = z.infer<typeof createForgeRunInputSchema>;
