import { z } from "zod";

export const entityIdSchema = z.string().min(1).max(128);

export const timestampSchema = z.number().int().nonnegative();

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Expected format YYYY-MM-DD");

export const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/u, "Expected format HH:MM");

export const metadataSchema = z.record(z.string(), z.unknown());

export const confidenceSchema = z.number().min(0).max(1);
