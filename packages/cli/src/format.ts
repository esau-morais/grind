import {
  type Quest,
  STREAK_TIERS,
  type UserProfile,
  calculateStreakInfo,
  xpForLevelThreshold,
} from "@grindxp/core";
import { c } from "./brand";
import { LEVEL_UNLOCKS } from "./copy";

export function xpBar(current: number, max: number, width = 20): string {
  const ratio = Math.min(1, current / Math.max(1, max));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `${c.xp}${"█".repeat(filled)}${c.ghost}${"░".repeat(empty)}${c.reset}`;
}

export function levelTitle(level: number): string {
  const titles: Record<number, string> = {
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
  return titles[level] ?? `Lv.${level}`;
}

export function formatUserHeader(user: UserProfile): string {
  const nextLvXp = xpForLevelThreshold(user.level + 1);
  const xpProgress = user.totalXp - xpForLevelThreshold(user.level);
  const xpNeeded = nextLvXp - xpForLevelThreshold(user.level);
  const bar = xpBar(xpProgress, xpNeeded);

  return [
    `${c.bold}${user.displayName}${c.reset}  ${c.level}Lv.${user.level} ${levelTitle(user.level)}${c.reset}`,
    `${bar} ${c.muted}${xpProgress}/${xpNeeded} XP to Lv.${user.level + 1}${c.reset}`,
    `${c.ghost}Total: ${user.totalXp} XP${c.reset}`,
  ].join("\n");
}

export function difficultyGem(d: string): string {
  switch (d) {
    case "easy":
      return `${c.easy}◆◇◇${c.reset}`;
    case "medium":
      return `${c.medium}◆◆◇${c.reset}`;
    case "hard":
      return `${c.hard}◆◆◆${c.reset}`;
    case "epic":
      return `${c.epic}◆◆◆+${c.reset}`;
    default:
      return d;
  }
}

export function questStatusIcon(status: string): string {
  switch (status) {
    case "active":
      return `${c.warn}▶${c.reset}`;
    case "completed":
      return `${c.success}✓${c.reset}`;
    case "failed":
      return `${c.danger}✗${c.reset}`;
    case "abandoned":
      return `${c.ghost}○${c.reset}`;
    case "available":
      return `${c.accent}·${c.reset}`;
    default:
      return "?";
  }
}

export function formatQuestLine(q: Quest): string {
  const icon = questStatusIcon(q.status);
  const diff = difficultyGem(q.difficulty);
  const streak =
    q.streakCount > 0
      ? ` ${c.streak}${calculateStreakInfo(q.streakCount).tierName} ${q.streakCount}d${c.reset}`
      : "";
  return `  ${icon} ${q.title}  ${diff}  ${c.ghost}${q.type}${c.reset}${streak}`;
}

export function formatQuestDetail(q: Quest): string {
  const streakInfo = calculateStreakInfo(q.streakCount);
  const lines = [
    `${c.bold}${q.title}${c.reset}`,
    `  Type:       ${q.type}`,
    `  Difficulty: ${difficultyGem(q.difficulty)}`,
    `  Status:     ${questStatusIcon(q.status)} ${q.status}`,
    `  Base XP:    ${q.baseXp}`,
    `  Streak:     ${streakInfo.count > 0 ? `${streakInfo.count}d (${streakInfo.tierName})` : "None"}`,
  ];
  if (q.description) lines.push(`  ${c.muted}${q.description}${c.reset}`);
  if (q.skillTags.length > 0) lines.push(`  Skills:     ${q.skillTags.join(", ")}`);
  lines.push(`  ${c.ghost}ID: ${q.id.slice(0, 8)}${c.reset}`);
  return lines.join("\n");
}

export function streakFireBar(currentDays: number, width = 20): string {
  if (currentDays <= 0) {
    return `${c.ghost}${"░".repeat(width)} No streak${c.reset}`;
  }

  const tier = STREAK_TIERS.find((t) => currentDays >= t.minDays && currentDays <= t.maxDays);
  const nextTier = STREAK_TIERS.find((t) => t.minDays > currentDays);
  const tierMax =
    tier?.maxDays === Number.POSITIVE_INFINITY ? currentDays : (tier?.maxDays ?? currentDays);
  const tierMin = tier?.minDays ?? 0;

  const ratio = Math.min(1, (currentDays - tierMin + 1) / (tierMax - tierMin + 1));
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  const fireIcon =
    currentDays >= 61 ? "🔥" : currentDays >= 15 ? "🔥" : currentDays >= 8 ? "🔥" : "🕯️";

  const tierColor = currentDays >= 61 ? c.streakHot : c.streak;
  const bar = `${tierColor}${"█".repeat(filled)}${c.ghost}${"░".repeat(empty)}${c.reset}`;
  const tierName = tier?.name ?? "None";

  const nextInfo = nextTier
    ? ` ${c.muted}→ ${nextTier.name} in ${nextTier.minDays - currentDays}d${c.reset}`
    : "";

  return `${fireIcon} ${bar} ${tierColor}${currentDays}d ${tierName}${c.reset}${nextInfo}`;
}

export function levelUpBox(newLevel: number, title: string): string {
  const unlock = LEVEL_UNLOCKS[newLevel] ?? "";
  const unlockLine = unlock ? `\n  ${c.accent}Unlocked: ${unlock}${c.reset}` : "";

  return [
    "",
    `  ${c.level}${c.bold}╔══════════════════════════════╗${c.reset}`,
    `  ${c.level}${c.bold}║${c.reset}  ${c.xpBright}${c.bold}▲ LEVEL UP ▲${c.reset}                ${c.level}${c.bold}║${c.reset}`,
    `  ${c.level}${c.bold}║${c.reset}                              ${c.level}${c.bold}║${c.reset}`,
    `  ${c.level}${c.bold}║${c.reset}  ${c.white}${c.bold}Lv.${newLevel} — ${title}${c.reset}${" ".repeat(Math.max(0, 22 - title.length - String(newLevel).length))}${c.level}${c.bold}║${c.reset}`,
    `  ${c.level}${c.bold}╚══════════════════════════════╝${c.reset}`,
    unlockLine,
    "",
  ].join("\n");
}
