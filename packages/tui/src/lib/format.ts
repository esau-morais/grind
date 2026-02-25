import { STREAK_TIERS, calculateStreakInfo, xpForLevelThreshold } from "@grindxp/core";
import type { Quest, UserProfile } from "@grindxp/core";

export const LEVEL_TITLES: Record<number, string> = {
  1: "Newcomer",
  2: "Initiate",
  3: "Apprentice",
  4: "Journeyman",
  5: "Adept",
  6: "Expert",
  7: "Veteran",
  8: "Master",
  9: "Grandmaster",
  10: "Legend",
};

export function levelTitle(level: number): string {
  return LEVEL_TITLES[level] ?? `Lv.${level}`;
}

export function xpProgress(user: UserProfile) {
  const currentThreshold = xpForLevelThreshold(user.level);
  const nextThreshold = xpForLevelThreshold(user.level + 1);
  const progress = user.totalXp - currentThreshold;
  const needed = nextThreshold - currentThreshold;
  return { progress, needed, ratio: needed > 0 ? progress / needed : 0 };
}

export function difficultyLabel(d: string): string {
  switch (d) {
    case "easy":
      return "◆◇◇";
    case "medium":
      return "◆◆◇";
    case "hard":
      return "◆◆◆";
    case "epic":
      return "◆◆◆+";
    default:
      return d;
  }
}

export function statusIcon(status: string): string {
  switch (status) {
    case "active":
      return "▶";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
    case "abandoned":
      return "○";
    case "available":
      return "·";
    default:
      return "?";
  }
}

export function formatElapsedShort(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function streakDisplay(count: number) {
  const info = calculateStreakInfo(count);
  const tier = STREAK_TIERS.find((t) => count >= t.minDays && count <= t.maxDays);
  const nextTier = STREAK_TIERS.find((t) => t.minDays > count);
  const tierMax = tier?.maxDays === Number.POSITIVE_INFINITY ? count : (tier?.maxDays ?? count);
  const tierMin = tier?.minDays ?? 0;
  const ratio = count > 0 ? Math.min(1, (count - tierMin + 1) / (tierMax - tierMin + 1)) : 0;

  return {
    ...info,
    ratio,
    nextTierName: nextTier?.name ?? null,
    daysToNext: nextTier ? nextTier.minDays - count : null,
    icon: count >= 8 ? "🔥" : count >= 1 ? "🕯️" : "",
  };
}
