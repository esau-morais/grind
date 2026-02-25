import * as p from "@clack/prompts";
import { formatElapsed, readTimer, writeTimer } from "@grindxp/core";
import { findQuestByPrefix, listQuestsByUser } from "@grindxp/core/vault";

import type { CliContext } from "../context";
import { noActiveQuests, timerAlreadyRunning, timerStarted } from "../copy";

export async function startCommand(ctx: CliContext, prefix?: string): Promise<void> {
  const { db, user, timerPath } = ctx;

  const existing = readTimer(timerPath);
  if (existing) {
    p.log.warn(timerAlreadyRunning(existing.questTitle, formatElapsed(existing.startedAt)));
    process.exit(1);
  }

  let quest;

  if (prefix) {
    quest = await findQuestByPrefix(db, user.id, prefix);
    if (!quest) {
      p.log.error(`No active quest matching "${prefix}".`);
      process.exit(1);
    }
  } else {
    const active = await listQuestsByUser(db, user.id, ["active"]);
    if (active.length === 0) {
      p.log.error(noActiveQuests());
      process.exit(1);
    }

    const choice = await p.select({
      message: "Which quest are you starting?",
      options: active.map((q) => ({
        value: q.id,
        label: q.title,
        hint: `${q.type} ${q.difficulty}`,
      })),
    });
    if (p.isCancel(choice)) {
      p.cancel();
      process.exit(0);
    }
    quest = active.find((q) => q.id === choice)!;
  }

  if (quest.status !== "active") {
    p.log.error(`Quest "${quest.title}" is ${quest.status}. Only active quests can be timed.`);
    process.exit(1);
  }

  writeTimer(timerPath, {
    questId: quest.id,
    questTitle: quest.title,
    userId: user.id,
    startedAt: Date.now(),
  });

  p.log.success(timerStarted(quest.title));
}
