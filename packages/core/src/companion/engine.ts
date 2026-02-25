import {
  type CompanionSettings,
  type CreateCompanionSettingsInput,
  type TrustLevel,
  companionSettingsSchema,
  createCompanionSettingsInputSchema,
} from "../schema";

import { DEFAULT_MODEL_BY_PROVIDER } from "./registry";

export const DEFAULT_SOUL = `Be direct. Skip filler. Have opinions.
When quests are completed, acknowledge briefly — don't over-celebrate.
When streaks break, be honest but not punishing.
Adjust your tone based on trust level.
You have access to quest history, skills, and streaks — use them to give relevant advice.`;

export function createCompanionSettings(input: CreateCompanionSettingsInput): CompanionSettings {
  const valid = createCompanionSettingsInputSchema.parse(input);
  const now = Date.now();

  return companionSettingsSchema.parse({
    ...valid,
    id: crypto.randomUUID(),
    trustLevel: valid.trustLevel ?? 0,
    trustScore: valid.trustScore ?? 0,
    model: valid.model || DEFAULT_MODEL_BY_PROVIDER[valid.provider],
    createdAt: now,
    updatedAt: now,
  });
}

export function updateCompanionTrust(
  current: CompanionSettings,
  trustDelta: number,
): CompanionSettings {
  const nextScore = Math.max(0, current.trustScore + trustDelta);
  const nextLevel = trustLevelFromScore(nextScore);

  return companionSettingsSchema.parse({
    ...current,
    trustScore: nextScore,
    trustLevel: nextLevel,
    updatedAt: Date.now(),
  });
}

export function trustLevelFromScore(score: number): TrustLevel {
  if (score >= 100) return 4;
  if (score >= 50) return 3;
  if (score >= 25) return 2;
  if (score >= 10) return 1;
  return 0;
}
