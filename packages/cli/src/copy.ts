const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

export function questCreated(): string {
  return pick([
    "Committed. No backing out.",
    "Locked in. The clock starts now.",
    "Quest accepted. Prove it.",
  ]);
}

export function questAbandoned(streakDays: number): string {
  if (streakDays >= 30) return `Dropped. ${streakDays} days — gone.`;
  if (streakDays >= 7) return `Dropped. ${streakDays}d streak wiped.`;
  if (streakDays > 0) return "Dropped. Streak reset to zero.";
  return pick(["Dropped. Nothing lost — nothing was built.", "Abandoned. No streak to lose."]);
}

export function abandonCancelled(): string {
  return pick(["Good. Keep grinding.", "Right call. Stay on it.", "Back to work."]);
}

export function timerStarted(questTitle: string): string {
  return pick([
    `Timer running — "${questTitle}". Go.`,
    `Clock's ticking on "${questTitle}".`,
    `"${questTitle}" — prove it with time.`,
  ]);
}

export function timerAlreadyRunning(questTitle: string, elapsed: string): string {
  return `Already timing "${questTitle}" (${elapsed}). Stop it first.`;
}

export function timerStopped(durationMin: number): string {
  if (durationMin < 5) return "That barely counts.";
  if (durationMin < 15) return "Short session. Better than nothing.";
  if (durationMin < 30) return "Decent. Keep stacking.";
  if (durationMin < 60) return "Solid session.";
  if (durationMin < 120) return "Strong work. That's real time invested.";
  return "Marathon session. Respect.";
}

export function questCompleted(streakDays: number, xpEarned: number): string {
  if (streakDays >= 90) return `Done. ${streakDays}d straight. Eternal fire.`;
  if (streakDays >= 30) return `Done. ${streakDays}d streak — blazing.`;
  if (streakDays >= 7) return `Done. That's ${streakDays}d straight.`;
  if (streakDays > 1) return `Done. ${streakDays}d and counting.`;
  return pick([
    "First one down. Build the streak.",
    "Done. One rep closer.",
    "Completed. Now do it again tomorrow.",
  ]);
}

export function selfReportNudge(): string {
  return pick([
    "Self-report = 1.0x. Use `grindxp start` next time for 1.5x.",
    "You get base XP. Timer proof would've been 1.5x.",
    "Logged, but no proof bonus. `grindxp start` next time.",
  ]);
}

export function questStale(staleDays: number): string {
  if (staleDays >= 7) return `This has been sitting for ${staleDays} days. Do it or drop it.`;
  if (staleDays >= 3) return `${staleDays} days idle. Losing momentum.`;
  return "";
}

export function logCompleted(activityType: string, durationMin: number, xpEarned: number): string {
  if (durationMin < 5) return `Logged ${activityType}. ${durationMin}m? Really?`;
  if (durationMin >= 120)
    return `${activityType} for ${durationMin}m. +${xpEarned} XP. Beast mode.`;
  if (durationMin >= 60) return `${activityType} for ${durationMin}m. +${xpEarned} XP. Solid.`;
  return `Logged: ${activityType} (${durationMin}m). +${xpEarned} XP.`;
}

export function greeting(hour: number): string {
  if (hour < 5) return "Late night grind.";
  if (hour < 12) return "Morning. Let's get after it.";
  if (hour < 17) return "Afternoon check-in.";
  if (hour < 21) return "Evening. How'd today go?";
  return "Night session. Wrapping up?";
}

export function noActiveQuests(): string {
  return pick([
    "No active quests. Commit to something: `grindxp quest create`",
    "Empty plate. `grindxp quest create` to commit.",
    "Nothing active. What are you working on?",
  ]);
}

export function timerBailTooShort(durationMin: number): string {
  return `${durationMin}m? Not even a minute. No XP for that.`;
}

export function maxQuestsReached(count: number): string {
  return `${count} active quests. Max is 5. Finish or drop one first. Focus beats volume.`;
}

export const LEVEL_UNLOCKS: Record<number, string> = {
  1: "Basic quests",
  2: "Skill trees visible",
  3: "Quest chains",
  4: "Forge automation",
  5: "Custom quest types",
  6: "AI companion",
  7: "Multi-proof bonuses",
  8: "Forge scripting",
  9: "Sovereign AI trust",
  10: "???",
};
