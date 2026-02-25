import { z } from "zod";

import { confidenceSchema, entityIdSchema, metadataSchema, timestampSchema } from "./common";

export const signalSourceSchema = z.enum([
  "google-calendar",
  "gmail",
  "file",
  "process",
  "git",
  "webhook",
  "manual",
  "companion",
]);

export const signalTypeSchema = z.enum([
  "activity",
  "drift",
  "focus",
  "completion",
  "schedule",
  "health",
  "context",
]);

export const signalSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    source: signalSourceSchema,
    type: signalTypeSchema,
    confidence: confidenceSchema,
    payload: metadataSchema.default({}),
    detectedAt: timestampSchema,
    ingestedAt: timestampSchema,
  })
  .strict();

export const createSignalInputSchema = signalSchema
  .omit({
    id: true,
    ingestedAt: true,
  })
  .strict();

export type SignalSource = z.infer<typeof signalSourceSchema>;
export type SignalType = z.infer<typeof signalTypeSchema>;
export type Signal = z.infer<typeof signalSchema>;
export type CreateSignalInput = z.infer<typeof createSignalInputSchema>;
