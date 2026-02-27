import { and, desc, eq, gte } from "drizzle-orm";

import { TRUST_LEVEL_NAMES } from "../constants";
import { calculateStreakInfo } from "../streak";
import type { TimerState } from "../timer";
import { formatElapsed } from "../timer";
import type { CompanionSettingsRow } from "../vault/schema";
import { questLogs, quests, skills, users } from "../vault/schema";
import type { VaultDb } from "../vault/types";
import { xpForLevelThreshold } from "../xp/constants";
import { DEFAULT_SOUL } from "./engine";

const TRUST_CAPABILITIES: Record<number, string> = {
  0: "act conservatively and favor suggestions before taking actions",
  1: "proactively suggest plans and execute straightforward requested actions",
  2: "act decisively on task and quest management when user intent is clear",
  3: "operate with high autonomy and minimize unnecessary confirmation friction",
  4: "operate at maximum autonomy while staying explicit about destructive changes",
};

const LEVEL_TITLES: Record<number, string> = {
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

export interface CompanionPromptContext {
  companion: CompanionSettingsRow;
  timer: TimerState | null;
}

export async function buildCompanionPrompt(
  db: VaultDb,
  ctx: CompanionPromptContext,
): Promise<string> {
  const { companion, timer } = ctx;

  const user = await db.query.users.findFirst({ where: eq(users.id, companion.userId) });
  if (!user) throw new Error("User not found");

  const activeQuests = await db.query.quests.findMany({
    where: and(eq(quests.userId, companion.userId), eq(quests.status, "active")),
  });

  const topSkills = await db.query.skills.findMany({
    where: eq(skills.userId, companion.userId),
    orderBy: desc(skills.xp),
    limit: 5,
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayLogs = await db.query.questLogs.findMany({
    where: and(
      eq(questLogs.userId, companion.userId),
      gte(questLogs.completedAt, todayStart.getTime()),
    ),
  });

  const sections: string[] = [];

  sections.push(buildBaseInstructions());

  const soul = companion.systemPrompt ?? DEFAULT_SOUL;
  sections.push(`## Personality\n\nEmbody this persona and tone:\n\n${soul}`);

  if (companion.userContext) {
    sections.push(`## User Context\n\n${companion.userContext}`);
  }

  sections.push(buildRuntimeContext(user, activeQuests, topSkills, todayLogs, timer));

  const trustName = TRUST_LEVEL_NAMES[companion.trustLevel] ?? "watcher";
  const caps = TRUST_CAPABILITIES[companion.trustLevel] ?? TRUST_CAPABILITIES[0];
  sections.push(
    `## Trust Level\n\nLevel ${companion.trustLevel} (${trustName}). You may: ${caps}.`,
  );

  return sections.join("\n\n");
}

function buildBaseInstructions(): string {
  return `You are the GRIND companion — a personal commitment engine inside a gamified life operating system.

CORE RULES:
- You are NOT a cheerleader. You respect effort, not intentions.
- Quests are promises, not todos. Abandoning costs streaks.
- Self-report gives 1.0x XP. Timer proof gives 1.5x. Push toward timers.
- When the user wants to quit, push back once. If they insist, respect it.
- Be direct, concise, slightly intense. Like a coach who cares.
- Max 5 active quests. Focus over volume.

TOOL USAGE:
- Use tools proactively. If the user describes a goal, break it into quests.
- After actions, confirm briefly. No walls of text.
- Keep responses to 1-3 sentences for simple actions.`;
}

function buildRuntimeContext(
  user: { displayName: string; level: number; totalXp: number },
  activeQuests: Array<{
    title: string;
    type: string;
    difficulty: string;
    streakCount: number;
    skillTags: string[];
  }>,
  topSkills: Array<{ name: string; level: number; xp: number }>,
  todayLogs: Array<{ xpEarned: number }>,
  timer: TimerState | null,
): string {
  const title = LEVEL_TITLES[user.level] ?? `Lv.${user.level}`;
  const nextThreshold = xpForLevelThreshold(user.level + 1);
  const xpToNext = nextThreshold - user.totalXp;
  const todayXp = todayLogs.reduce((sum, l) => sum + l.xpEarned, 0);
  const bestStreak = activeQuests.reduce((max, q) => Math.max(max, q.streakCount), 0);

  const hour = new Date().getHours();
  const timeOfDay =
    hour < 6 ? "late night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  const lines: string[] = ["## Current State", ""];
  lines.push(`Name: ${user.displayName}`);
  lines.push(`Level: ${user.level} (${title}) — ${user.totalXp} XP, ${xpToNext} to next level`);
  lines.push(`Time: ${timeOfDay}`);
  lines.push(`XP today: +${todayXp} (${todayLogs.length} completions)`);

  if (bestStreak > 0) {
    const streakInfo = calculateStreakInfo(bestStreak);
    lines.push(`Best streak: ${bestStreak} days (${streakInfo.tierName})`);
  }

  if (activeQuests.length > 0) {
    lines.push("");
    lines.push("Active quests:");
    for (const q of activeQuests) {
      const tags = q.skillTags.length > 0 ? ` [${q.skillTags.join(", ")}]` : "";
      lines.push(`  - "${q.title}" (${q.type}, ${q.difficulty})${tags}`);
    }
  } else {
    lines.push("Active quests: none");
  }

  if (topSkills.length > 0) {
    lines.push("");
    lines.push("Top skills:");
    for (const s of topSkills) {
      lines.push(`  - ${s.name} Lv.${s.level} (${s.xp} XP)`);
    }
  }

  if (timer) {
    lines.push("");
    lines.push(`Timer running: "${timer.questTitle}" — ${formatElapsed(timer.startedAt)} elapsed`);
  }

  return lines.join("\n");
}
