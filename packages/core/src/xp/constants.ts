import type { ActivityType, ProofType, QuestDifficulty } from "../schema";

export const DIFFICULTY_MULTIPLIERS: Record<QuestDifficulty, number> = {
  easy: 1,
  medium: 1.5,
  hard: 2.5,
  epic: 4,
};

export const PROOF_MULTIPLIERS: Record<ProofType, number> = {
  "self-report": 1,
  timestamp: 1.1,
  duration: 1.5,
  screenshot: 1.25,
  "git-commit": 1.5,
  "file-change": 1.5,
  "process-check": 1.5,
  "ai-verify": 1.75,
  "calendar-match": 1.1,
  "multi-proof": 2,
};

export const ACTIVITY_BASE_XP: Record<ActivityType, number> = {
  workout: 20,
  study: 25,
  coding: 15,
  music: 15,
  cooking: 10,
  reading: 10,
  meditation: 10,
  other: 10,
};

export const SKILL_LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500] as const;

export function xpForLevelThreshold(level: number): number {
  if (level <= 1) {
    return 0;
  }

  return 50 * level * level + 50 * level;
}
