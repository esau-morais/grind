import * as p from "@clack/prompts";
import { readTimer } from "@grindxp/core";
import {
  completeQuest,
  findQuestByPrefix,
  getUserById,
  listQuestsByUser,
} from "@grindxp/core/vault";

import type { CliContext } from "../context";
import { questCompleted, selfReportNudge } from "../copy";
import { levelTitle, levelUpBox } from "../format";

export async function completeCommand(ctx: CliContext, prefix?: string): Promise<void> {
  const { db, user, timerPath } = ctx;

  const timer = readTimer(timerPath);
  if (timer) {
    p.log.warn("You have a timer running.");
    p.log.info(selfReportNudge());

    const proceed = await p.confirm({
      message: "Complete via self-report anyway? (lower XP)",
    });
    if (p.isCancel(proceed) || !proceed) return;
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
      p.log.error("No active quests to complete.");
      process.exit(1);
    }

    const choice = await p.select({
      message: "Which quest did you complete?",
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
    p.log.error(`Quest "${quest.title}" is ${quest.status}.`);
    process.exit(1);
  }

  const prevLevel = user.level;

  const result = await completeQuest(db, {
    questId: quest.id,
    userId: user.id,
    proofType: "self-report",
    proofData: { method: "cli-complete" },
  });

  p.log.success(questCompleted(quest.streakCount + 1, result.xpEarned));
  p.log.info(`+${result.xpEarned} XP (self-report, 1.0x)`);

  if (!timer) {
    p.log.message(selfReportNudge());
  }

  const updatedUser = await getUserById(db, user.id);
  if (updatedUser && updatedUser.level > prevLevel) {
    p.log.message(levelUpBox(updatedUser.level, levelTitle(updatedUser.level)));
  }
}
