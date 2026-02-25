import * as p from "@clack/prompts";
import {
  ACTIVITY_BASE_XP,
  type ActivityType,
  type QuestDifficulty,
  activityTypeSchema,
} from "@grindxp/core";
import { completeQuest, createQuest, getUserById } from "@grindxp/core/vault";

import type { CliContext } from "../context";
import { logCompleted } from "../copy";
import { levelTitle, levelUpBox } from "../format";

const ACTIVITY_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: "workout", label: "Workout" },
  { value: "study", label: "Study" },
  { value: "coding", label: "Coding" },
  { value: "music", label: "Music" },
  { value: "cooking", label: "Cooking" },
  { value: "reading", label: "Reading" },
  { value: "meditation", label: "Meditation" },
  { value: "other", label: "Other" },
];

export async function logCommand(ctx: CliContext, args: string[]): Promise<void> {
  const { db, user } = ctx;

  let activityType: ActivityType | undefined;
  let durationMinutes: number | undefined;

  if (args[0]) {
    const parsed = activityTypeSchema.safeParse(args[0]);
    if (parsed.success) activityType = parsed.data;
  }

  if (args[1]) {
    const n = Number.parseInt(args[1], 10);
    if (!Number.isNaN(n) && n > 0) durationMinutes = n;
  }

  if (!activityType) {
    const choice = await p.select({
      message: "What did you do?",
      options: ACTIVITY_OPTIONS.map((o) => ({
        value: o.value,
        label: o.label,
        hint: `${ACTIVITY_BASE_XP[o.value]} base XP`,
      })),
    });
    if (p.isCancel(choice)) {
      p.cancel();
      process.exit(0);
    }
    activityType = choice as ActivityType;
  }

  if (durationMinutes === undefined) {
    const dur = await p.text({
      message: "Duration in minutes:",
      placeholder: "e.g. 45",
      validate: (v) => {
        if (!v) return "Duration is required.";
        const n = Number.parseInt(v, 10);
        if (Number.isNaN(n) || n < 1) return "Enter a positive number.";
        if (n > 1440) return "Max 1440 minutes (24h).";
        return undefined;
      },
    });
    if (p.isCancel(dur)) {
      p.cancel();
      process.exit(0);
    }
    durationMinutes = Number.parseInt(dur as string, 10);
  }

  const baseXp = ACTIVITY_BASE_XP[activityType];
  const prevLevel = user.level;

  const quest = await createQuest(db, {
    userId: user.id,
    title: `${activityType} (${durationMinutes}m)`,
    type: "bounty" as const,
    difficulty: "easy" as QuestDifficulty,
    skillTags: [activityType],
    baseXp,
    metadata: {},
    objectives: [],
  });

  const result = await completeQuest(db, {
    questId: quest.id,
    userId: user.id,
    durationMinutes,
    proofType: "self-report",
    proofData: { activityType, durationMinutes, method: "cli-log" },
  });

  p.log.success(logCompleted(activityType, durationMinutes, result.xpEarned));

  const updatedUser = await getUserById(db, user.id);
  if (updatedUser && updatedUser.level > prevLevel) {
    p.log.message(levelUpBox(updatedUser.level, levelTitle(updatedUser.level)));
  }
}
