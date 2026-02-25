import * as p from "@clack/prompts";
import { formatElapsed, readTimer } from "@grindxp/core";
import { listQuestsByUser } from "@grindxp/core/vault";

import { c } from "../brand";
import type { CliContext } from "../context";
import { greeting, noActiveQuests, questStale } from "../copy";
import { formatQuestLine, formatUserHeader, streakFireBar } from "../format";

type Mode = "morning" | "afternoon" | "evening";

function getMode(hour: number): Mode {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export async function dashboardCommand(ctx: CliContext): Promise<void> {
  const { db, user, timerPath } = ctx;
  const hour = new Date().getHours();
  const timer = readTimer(timerPath);

  p.box(formatUserHeader(user), greeting(hour));

  if (timer) {
    const elapsed = formatElapsed(timer.startedAt);
    p.log.warn(`${c.streak}⏱  ${timer.questTitle}${c.reset} — ${elapsed}`);
    p.log.message(`${c.muted}Run \`grindxp stop\` when done. Timer proof = 1.5x XP.${c.reset}`);
  }

  const active = await listQuestsByUser(db, user.id, ["active"]);
  const completed = await listQuestsByUser(db, user.id, ["completed"]);

  const mode = timer ? "afternoon" : getMode(hour);

  switch (mode) {
    case "morning":
      await morningBriefing(active, completed);
      break;
    case "afternoon":
      await afternoonFocus(active);
      break;
    case "evening":
      await eveningRecap(active, completed, user.totalXp);
      break;
  }

  const maxStreak = Math.max(0, ...active.map((q) => q.streakCount));
  if (maxStreak > 0) {
    p.log.message(streakFireBar(maxStreak));
  }
}

async function morningBriefing(
  active: Awaited<ReturnType<typeof listQuestsByUser>>,
  completed: Awaited<ReturnType<typeof listQuestsByUser>>,
): Promise<void> {
  if (active.length === 0) {
    p.log.info(noActiveQuests());
    return;
  }

  p.log.step(`${c.bold}Today's quests${c.reset} (${active.length} active)`);

  const now = Date.now();
  for (const q of active) {
    p.log.message(formatQuestLine(q));
    const staleDays = Math.floor((now - q.updatedAt) / 86_400_000);
    const staleMsg = questStale(staleDays);
    if (staleMsg) p.log.message(`    ${c.warn}${staleMsg}${c.reset}`);
  }

  const overdue = active.filter((q) => q.deadlineAt && q.deadlineAt < now);
  if (overdue.length > 0) {
    p.log.warn(`${overdue.length} quest${overdue.length > 1 ? "s" : ""} overdue`);
  }
}

async function afternoonFocus(active: Awaited<ReturnType<typeof listQuestsByUser>>): Promise<void> {
  if (active.length === 0) {
    p.log.info(noActiveQuests());
    return;
  }

  p.log.step(
    `${c.bold}Focus${c.reset} — ${active.length} active quest${active.length !== 1 ? "s" : ""}`,
  );
  for (const q of active) {
    p.log.message(formatQuestLine(q));
  }
}

async function eveningRecap(
  active: Awaited<ReturnType<typeof listQuestsByUser>>,
  completed: Awaited<ReturnType<typeof listQuestsByUser>>,
  totalXp: number,
): Promise<void> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const completedToday = completed.filter(
    (q) => q.completedAt !== undefined && q.completedAt >= todayMs,
  );

  if (completedToday.length > 0) {
    p.log.step(`${c.bold}Completed today${c.reset} (${completedToday.length})`);
    for (const q of completedToday) {
      p.log.message(formatQuestLine(q));
    }
  } else {
    p.log.info(`${c.muted}Nothing completed today.${c.reset}`);
  }

  if (active.length > 0) {
    p.log.step(`${c.bold}Still active${c.reset} (${active.length})`);
    for (const q of active) {
      p.log.message(formatQuestLine(q));
    }
  }
}
