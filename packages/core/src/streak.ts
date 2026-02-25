export const STREAK_TIERS = [
  { name: "Spark", minDays: 1, maxDays: 7, bonusPerDay: 0.5 },
  { name: "Flame", minDays: 8, maxDays: 14, bonusPerDay: 1.0 },
  { name: "Fire", minDays: 15, maxDays: 30, bonusPerDay: 1.5 },
  { name: "Blaze", minDays: 31, maxDays: 60, bonusPerDay: 2.0 },
  { name: "Inferno", minDays: 61, maxDays: 90, bonusPerDay: 3.0 },
  { name: "Eternal Fire", minDays: 91, maxDays: Number.POSITIVE_INFINITY, bonusPerDay: 5.0 },
] as const;

export interface StreakInfo {
  count: number;
  tierName: string;
  bonusPerDay: number;
  totalBonus: number;
  shieldsEarned: number;
}

export function getStreakTier(days: number) {
  if (days <= 0) return null;
  return STREAK_TIERS.find((t) => days >= t.minDays && days <= t.maxDays) ?? null;
}

export function calculateStreakInfo(count: number): StreakInfo {
  if (count <= 0) {
    return { count: 0, tierName: "None", bonusPerDay: 0, totalBonus: 0, shieldsEarned: 0 };
  }

  const tier = getStreakTier(count);
  return {
    count,
    tierName: tier?.name ?? "None",
    bonusPerDay: tier?.bonusPerDay ?? 0,
    totalBonus: Math.min(25, Math.floor(count * 0.5)),
    shieldsEarned: Math.floor(count / 30),
  };
}

export function applyStreakPenalty(currentStreak: number, daysMissed: number): number {
  if (daysMissed <= 0) return currentStreak;
  if (daysMissed === 1) return currentStreak;
  if (daysMissed === 2) return Math.floor(currentStreak / 2);
  return 0;
}

export function formatStreakDisplay(count: number): string {
  if (count <= 0) return "No streak";
  const tier = getStreakTier(count);
  return `${count}d ${tier?.name ?? ""}`.trim();
}
