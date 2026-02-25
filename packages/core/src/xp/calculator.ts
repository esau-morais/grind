import { z } from "zod";

import {
  type ProofType,
  type QuestDifficulty,
  proofTypeSchema,
  questDifficultySchema,
} from "../schema";
import {
  DIFFICULTY_MULTIPLIERS,
  PROOF_MULTIPLIERS,
  SKILL_LEVEL_THRESHOLDS,
  xpForLevelThreshold,
} from "./constants";

const calculateQuestXpInputSchema = z
  .object({
    baseXp: z.number().int().positive(),
    difficulty: questDifficultySchema,
    streakDays: z.number().int().nonnegative().default(0),
    proofType: proofTypeSchema,
  })
  .strict();

export interface QuestXpResult {
  baseXp: number;
  scaledBaseXp: number;
  streakBonus: number;
  proofBonus: number;
  totalXp: number;
}

export function calculateQuestXp(input: {
  baseXp: number;
  difficulty: QuestDifficulty;
  streakDays: number;
  proofType: ProofType;
}): QuestXpResult {
  const valid = calculateQuestXpInputSchema.parse(input);

  const scaledBaseXp = Math.round(valid.baseXp * DIFFICULTY_MULTIPLIERS[valid.difficulty]);
  const streakBonus = Math.min(25, Math.floor(valid.streakDays * 0.5));
  const proofBonus = Math.round(scaledBaseXp * (PROOF_MULTIPLIERS[valid.proofType] - 1));
  const totalXp = scaledBaseXp + streakBonus + proofBonus;

  return {
    baseXp: valid.baseXp,
    scaledBaseXp,
    streakBonus,
    proofBonus,
    totalXp,
  };
}

export function xpForLevel(level: number): number {
  return xpForLevelThreshold(level);
}

export function levelFromXp(totalXp: number): number {
  if (totalXp <= 0) {
    return 1;
  }

  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) {
    level += 1;
  }

  return level;
}

export function skillLevelFromXp(skillXp: number): number {
  const normalized = Math.max(0, Math.floor(skillXp));

  if (normalized >= SKILL_LEVEL_THRESHOLDS[5]) {
    return 5;
  }
  if (normalized >= SKILL_LEVEL_THRESHOLDS[4]) {
    return 4;
  }
  if (normalized >= SKILL_LEVEL_THRESHOLDS[3]) {
    return 3;
  }
  if (normalized >= SKILL_LEVEL_THRESHOLDS[2]) {
    return 2;
  }
  if (normalized >= SKILL_LEVEL_THRESHOLDS[1]) {
    return 1;
  }

  return 0;
}
