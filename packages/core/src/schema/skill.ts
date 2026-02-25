import { z } from "zod";

import { entityIdSchema, metadataSchema, timestampSchema } from "./common";

export const proficiencyLevelSchema = z.number().int().min(0).max(5);

export const skillCategorySchema = z.enum(["fitness", "music", "academics", "discipline", "life"]);

export const skillSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    name: z.string().min(1).max(128),
    category: skillCategorySchema,
    parentId: entityIdSchema.optional(),
    xp: z.number().int().nonnegative().default(0),
    level: proficiencyLevelSchema.default(0),
    metadata: metadataSchema.default({}),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const skillNodeSchema = z
  .object({
    skill: skillSchema,
    children: z.array(entityIdSchema).default([]),
  })
  .strict();

export type ProficiencyLevel = z.infer<typeof proficiencyLevelSchema>;
export type SkillCategory = z.infer<typeof skillCategorySchema>;
export type Skill = z.infer<typeof skillSchema>;
export type SkillNode = z.infer<typeof skillNodeSchema>;
