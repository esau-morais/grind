import * as p from "@clack/prompts";
import { clearTimer, getElapsedMinutes, readTimer } from "@grindxp/core";
import { completeQuest, getQuestById, getUserById } from "@grindxp/core/vault";

import type { CliContext } from "../context";
import { questCompleted, timerBailTooShort, timerStopped } from "../copy";
import { levelTitle, levelUpBox } from "../format";

export async function stopCommand(ctx: CliContext): Promise<void> {
  const { db, user, timerPath } = ctx;

  const timer = readTimer(timerPath);
  if (!timer) {
    p.log.error("No timer running. Start one with `grindxp start`.");
    process.exit(1);
  }

  const elapsed = getElapsedMinutes(timer.startedAt);
  const quest = await getQuestById(db, timer.questId);

  if (!quest || quest.status !== "active") {
    clearTimer(timerPath);
    p.log.warn("Timer cleared — quest is no longer active.");
    process.exit(1);
  }

  if (elapsed < 1) {
    const bailEarly = await p.confirm({
      message: `${timerBailTooShort(elapsed)} Stop anyway?`,
    });
    if (p.isCancel(bailEarly) || !bailEarly) {
      p.log.info("Timer continues.");
      return;
    }
    clearTimer(timerPath);
    p.log.warn("Timer cleared. No XP awarded.");
    return;
  }

  const confirm = await p.confirm({
    message: `Complete "${quest.title}" after ${elapsed}m? (Timer proof = 1.5x XP)`,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.log.info("Timer continues. Run `grindxp stop` when ready.");
    return;
  }

  const prevLevel = user.level;

  const result = await completeQuest(db, {
    questId: quest.id,
    userId: user.id,
    durationMinutes: elapsed,
    proofType: "duration",
    proofData: { startedAt: timer.startedAt, stoppedAt: Date.now(), elapsedMinutes: elapsed },
  });

  clearTimer(timerPath);

  p.log.success(timerStopped(elapsed));
  p.log.info(`+${result.xpEarned} XP (duration proof, 1.5x)`);
  p.log.message(questCompleted(quest.streakCount + 1, result.xpEarned));

  const updatedUser = await getUserById(db, user.id);
  if (updatedUser && updatedUser.level > prevLevel) {
    p.log.message(levelUpBox(updatedUser.level, levelTitle(updatedUser.level)));
  }
}
