import { z } from "zod";

import { entityIdSchema, metadataSchema, timestampSchema } from "./common";

export const proofTypes = [
  "self-report",
  "timestamp",
  "duration",
  "screenshot",
  "git-commit",
  "file-change",
  "process-check",
  "ai-verify",
  "calendar-match",
  "multi-proof",
] as const;

export const proofTypeSchema = z.enum(proofTypes);

export const proofSchema = z
  .object({
    id: entityIdSchema,
    questLogId: entityIdSchema,
    type: proofTypeSchema,
    confidence: z.number().min(0).max(1).optional(),
    data: metadataSchema.default({}),
    createdAt: timestampSchema,
  })
  .strict();

export const completeQuestInputSchema = z
  .object({
    questId: entityIdSchema,
    completedAt: timestampSchema.optional(),
    durationMinutes: z
      .number()
      .int()
      .positive()
      .max(24 * 60)
      .optional(),
    proofType: proofTypeSchema.default("self-report"),
    proofConfidence: z.number().min(0).max(1).optional(),
    proofData: metadataSchema.default({}),
  })
  .strict();

export type ProofType = z.infer<typeof proofTypeSchema>;
export type Proof = z.infer<typeof proofSchema>;
export type CompleteQuestInput = z.infer<typeof completeQuestInputSchema>;
