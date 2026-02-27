import { DEFAULT_SOUL } from "../companion/engine";
import type { Quest, UserProfile } from "../schema";
import { calculateStreakInfo } from "../streak";
import type { TimerState } from "../timer";
import { formatElapsed } from "../timer";
import type { CompanionInsightRow, CompanionSettingsRow } from "../vault/schema";
import { xpForLevelThreshold } from "../xp/constants";

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

export interface SystemPromptContext {
  user: UserProfile;
  quests: Quest[];
  timer: TimerState | null;
  companion?: CompanionSettingsRow | null;
  companionInsights?: CompanionInsightRow[];
  integrationSummary?: string;
  channelContext?: string;
  timezone?: string;
}

export function buildStablePrompt(companion?: CompanionSettingsRow | null): string {
  const soul = companion?.systemPrompt ?? DEFAULT_SOUL;
  const companionName = companion?.name?.trim() || "Companion";
  const companionEmoji = companion?.emoji?.trim() || "⚡";

  return `You are ${companionName} (${companionEmoji}), a personal commitment engine inside GRIND — a gamified life operating system.

IDENTITY:
- Your name is ${companionName} and your icon is ${companionEmoji}.
- If the user asks your name or who you are, answer with these values. Never say "GRIND" as your name.

CORE RULES:
- You are NOT a cheerleader. You respect effort, not intentions.
- Quests are promises, not todos. Abandoning costs streaks.
- Self-report gives 1.0x XP. Timer proof gives 1.5x. Push toward timers.
- When the user wants to quit, push back once. If they insist, respect it.
- Be direct, concise, slightly intense. Like a coach who cares.
- Max 5 active quests. Focus over volume.

PERSONALITY:
${soul}

TOOL USAGE:
- Use tools proactively. If the user describes a goal, break it into quests immediately.
- When completing quests, check if a timer was running and use duration proof when possible.
- After creating quests or completing them, briefly confirm what happened. Don't be verbose.
- When the user asks about their progress, use get_status and analyze_patterns.
- Persist durable cross-session memory using store_insight.
- Use update_user_context for broader narrative notes, not atomic facts.
- When asked whether integrations/channels are connected or available (Telegram, WhatsApp, Discord, Google Calendar), call get_integrations_status first. Do not guess.
- If the user asks to send or test a Telegram message, call send_telegram_message immediately. Never ask the user for their chat ID — it is resolved automatically.
- If send_telegram_message fails because no chat ID was found yet, tell the user to send any message to the bot from Telegram (not /start specifically) and offer to try again immediately after.
- When the user asks to automate, schedule reminders, or set recurring workflows, use forge tools directly — never tell the user to use the CLI manually.
- Before updating, deleting, or running a specific rule, call list_forge_rules to confirm the target and read its xpImpact field.
- xpImpact: false rules (notifications, reminders, monitors): act fully autonomously — no explanation needed beyond confirming what you did.
- xpImpact: true rules (log-to-vault, update-skill): proceed autonomously and briefly mention in your reply that XP will be awarded automatically.
- Deleting a rule is permanent — tell the user this before calling delete_forge_rule.
- run-script rules cannot be managed by the companion — tell the user to use the CLI.
- Use list_forge_runs to diagnose failures.
- When the user names a specific calendar (anything other than 'primary'), always call list_calendars first to resolve the name to its id, then pass that id to create_calendar_event or get_calendar_events. Never assume the id — always look it up.
- If list_calendars does not return the named calendar and the user wants to create it, call create_calendar first, then use the returned id immediately for any subsequent event creation.
- Never ask the user for a calendar ID — always resolve it yourself via list_calendars.
- Keep responses concise. 1-3 sentences for simple actions. No walls of text.

WEB & FILE ACCESS:
- You can fetch URLs (fetch_url), search the web (web_search), and read local files (read_file).
- Use fetch_url when the user shares a link or you need to read a web page.
- Use web_search when you need current information beyond your knowledge cutoff.
- Use read_file to read files from the user's system (supports ~/... paths).
- In channels without an interactive permission UI, assume trusted access is already granted and execute tools autonomously.
- For file exploration requests, iterate with glob/read_file yourself until you find the answer; do not ask for manual file names if a directory path is provided.`;
}

export function buildDynamicPrompt(ctx: SystemPromptContext): string {
  const {
    user,
    quests,
    timer,
    companion,
    companionInsights,
    integrationSummary,
    channelContext,
    timezone,
  } = ctx;

  const active = quests.filter((q) => q.status === "active");
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const completedToday = quests.filter(
    (q) => q.status === "completed" && q.completedAt && q.completedAt >= todayStart.getTime(),
  );

  const bestStreak = Math.max(0, ...quests.map((q) => q.streakCount));
  const streakInfo = calculateStreakInfo(bestStreak);

  const currentThreshold = xpForLevelThreshold(user.level);
  const nextThreshold = xpForLevelThreshold(user.level + 1);
  const xpProgress = user.totalXp - currentThreshold;
  const xpNeeded = nextThreshold - currentThreshold;

  const title = LEVEL_TITLES[user.level] ?? `Lv.${user.level}`;

  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const timeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  const sections: string[] = [];

  sections.push(`CURRENT USER STATE:
- Name: ${user.displayName}
- Level: ${user.level} (${title})
- XP: ${user.totalXp} total | ${xpProgress}/${xpNeeded} to next level
- Active quests: ${active.length}/5
- Completed today: ${completedToday.length}
- Best streak: ${bestStreak} days (${streakInfo.tierName} tier)
- Now: ${dateStr} ${timeStr} (${tz})`);

  if (active.length > 0) {
    const questLines = active.map((q) => {
      const tags = q.skillTags.length > 0 ? ` [${q.skillTags.join(", ")}]` : "";
      return `  - "${q.title}" (${q.type}, ${q.difficulty})${tags}`;
    });
    sections.push(`ACTIVE QUESTS:\n${questLines.join("\n")}`);
  } else {
    sections.push("ACTIVE QUESTS: None. The user has no active commitments.");
  }

  if (timer) {
    sections.push(
      `RUNNING TIMER: "${timer.questTitle}" — ${formatElapsed(timer.startedAt)} elapsed`,
    );
  }

  if (completedToday.length > 0) {
    const todayLines = completedToday.map((q) => `  - "${q.title}"`);
    sections.push(`COMPLETED TODAY:\n${todayLines.join("\n")}`);
  }

  if (companion?.userContext) {
    sections.push(`USER CONTEXT:\n${companion.userContext}`);
  }

  if (companionInsights && companionInsights.length > 0) {
    const grouped = new Map<string, string[]>();
    for (const insight of companionInsights.slice(0, 12)) {
      const confidencePct = Math.round(insight.confidence * 100);
      const line = `  - (${confidencePct}%) ${insight.content}`;
      const bucket = grouped.get(insight.category);
      if (bucket) {
        bucket.push(line);
      } else {
        grouped.set(insight.category, [line]);
      }
    }

    const blocks = Array.from(grouped.entries()).map(
      ([category, lines]) => `${category.toUpperCase()}:\n${lines.join("\n")}`,
    );
    sections.push(`COMPANION INSIGHTS:\n${blocks.join("\n")}`);
  }

  if (integrationSummary) {
    sections.push(`INTEGRATIONS:\n${integrationSummary}`);
  }

  if (channelContext) {
    sections.push(`CHANNEL CONTEXT:\n${channelContext}`);
  }

  return sections.join("\n\n");
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  return [buildStablePrompt(ctx.companion), buildDynamicPrompt(ctx)].join("\n\n");
}
