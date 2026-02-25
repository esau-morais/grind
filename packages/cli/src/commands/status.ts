import * as p from "@clack/prompts";
import { formatElapsed, readTimer } from "@grindxp/core";
import { listQuestsByUser } from "@grindxp/core/vault";

import type { CliContext } from "../context";
import { formatQuestLine, formatUserHeader } from "../format";

export async function statusCommand(ctx: CliContext): Promise<void> {
  const { db, user, timerPath } = ctx;

  p.box(formatUserHeader(user), "GRIND");

  const timer = readTimer(timerPath);
  if (timer) {
    p.log.warn(`Timer running: ${timer.questTitle} (${formatElapsed(timer.startedAt)})`);
  }

  const active = await listQuestsByUser(db, user.id, ["active"]);
  const completed = await listQuestsByUser(db, user.id, ["completed"]);

  if (active.length > 0) {
    p.log.step(`Active Quests (${active.length})`);
    for (const q of active) {
      p.log.message(formatQuestLine(q));
    }
  } else {
    p.log.info("No active quests. Run `grindxp quest create` to commit.");
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const completedToday = completed.filter(
    (q) => q.completedAt !== undefined && q.completedAt >= todayMs,
  );

  if (completedToday.length > 0) {
    p.log.step(`Completed Today (${completedToday.length})`);
    for (const q of completedToday) {
      p.log.message(formatQuestLine(q));
    }
  }
}
