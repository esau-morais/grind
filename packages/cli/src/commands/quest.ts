import * as p from "@clack/prompts";
import type { QuestDifficulty, QuestType } from "@grindxp/core";
import {
  createQuest,
  findQuestByPrefix,
  listQuestsByUser,
  updateQuestStatus,
} from "@grindxp/core/vault";

import { c } from "../brand";
import type { CliContext } from "../context";
import { abandonCancelled, maxQuestsReached, questAbandoned, questCreated } from "../copy";
import { difficultyGem, formatQuestDetail, formatQuestLine } from "../format";

function bail(msg?: string): never {
  p.cancel(msg ?? "Cancelled.");
  process.exit(0);
}

export async function questCreateCommand(ctx: CliContext): Promise<void> {
  const { db, user } = ctx;

  const active = await listQuestsByUser(db, user.id, ["active"]);
  if (active.length >= 5) {
    p.log.warn(maxQuestsReached(active.length));
    return;
  }

  p.intro(`${c.bold}New Quest${c.reset} — This is a commitment, not a wish list.`);

  const title = await p.text({
    message: "Quest name:",
    placeholder: 'e.g. "45min Chest Workout"',
    validate: (v) => {
      if (!v || v.length < 2) return "Quest name is required (min 2 chars).";
      if (v.length > 256) return "Too long.";
      return undefined;
    },
  });
  if (p.isCancel(title)) return bail();

  const type = await p.select({
    message: "Quest type:",
    options: [
      { value: "daily" as const, label: "Daily", hint: "Repeating. Builds streaks." },
      { value: "bounty" as const, label: "Bounty", hint: "One-off task." },
      { value: "epic" as const, label: "Epic", hint: "Multi-step, long-term goal." },
      { value: "weekly" as const, label: "Weekly", hint: "Repeats weekly." },
      { value: "chain" as const, label: "Chain", hint: "Sequential quests." },
      { value: "ritual" as const, label: "Ritual", hint: "Time-triggered pattern." },
    ],
  });
  if (p.isCancel(type)) return bail();

  const difficulty = await p.select({
    message: "Difficulty (affects XP multiplier):",
    options: [
      { value: "easy" as const, label: `Easy ${difficultyGem("easy")}`, hint: "1.0x" },
      { value: "medium" as const, label: `Medium ${difficultyGem("medium")}`, hint: "1.5x" },
      { value: "hard" as const, label: `Hard ${difficultyGem("hard")}`, hint: "2.5x" },
      { value: "epic" as const, label: `Epic ${difficultyGem("epic")}`, hint: "4.0x" },
    ],
  });
  if (p.isCancel(difficulty)) return bail();

  const skillTagsRaw = await p.text({
    message: "Skill tags (comma-separated, or empty):",
    placeholder: "e.g. fitness:strength, discipline:consistency",
    initialValue: "",
  });
  if (p.isCancel(skillTagsRaw)) return bail();

  const skillTags = (skillTagsRaw as string)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const confirm = await p.confirm({
    message: `Commit to "${title}"? Once active, abandoning resets your streak.`,
  });
  if (p.isCancel(confirm) || !confirm) return bail("Quest not created.");

  const quest = await createQuest(db, {
    userId: user.id,
    title: title as string,
    type: type as QuestType,
    difficulty: difficulty as QuestDifficulty,
    skillTags,
    baseXp: 10,
    metadata: {},
    objectives: [],
  });

  p.log.success(questCreated());
  p.outro(`Use \`grindxp start ${quest.id.slice(0, 8)}\` to begin.`);
}

export async function questListCommand(ctx: CliContext): Promise<void> {
  const { db, user } = ctx;

  const quests = await listQuestsByUser(db, user.id);

  if (quests.length === 0) {
    p.log.info("No quests yet. Run `grindxp quest create` to commit.");
    return;
  }

  const active = quests.filter((q) => q.status === "active");
  const completed = quests.filter((q) => q.status === "completed");
  const rest = quests.filter((q) => !["active", "completed"].includes(q.status));

  if (active.length > 0) {
    p.log.step(`${c.bold}Active${c.reset} (${active.length})`);
    for (const q of active) p.log.message(formatQuestLine(q));
  }

  if (completed.length > 0) {
    p.log.step(`${c.bold}Completed${c.reset} (${completed.length})`);
    for (const q of completed.slice(0, 10)) p.log.message(formatQuestLine(q));
    if (completed.length > 10)
      p.log.info(`${c.muted}... and ${completed.length - 10} more${c.reset}`);
  }

  if (rest.length > 0) {
    p.log.step(`${c.bold}Other${c.reset} (${rest.length})`);
    for (const q of rest) p.log.message(formatQuestLine(q));
  }
}

export async function questAbandonCommand(ctx: CliContext, prefix: string): Promise<void> {
  const { db, user } = ctx;

  if (!prefix) {
    p.log.error("Usage: grindxp quest abandon <quest-id-or-name>");
    process.exit(1);
  }

  const quest = await findQuestByPrefix(db, user.id, prefix);

  if (!quest) {
    p.log.error(`No active quest matching "${prefix}".`);
    process.exit(1);
  }

  if (quest.status !== "active") {
    p.log.error(`Quest "${quest.title}" is ${quest.status}, not active.`);
    process.exit(1);
  }

  p.note(formatQuestDetail(quest), quest.title);

  p.note(
    [
      "Abandoning a quest has consequences:",
      `  - Your streak (${quest.streakCount}d) will be reset to 0`,
      "  - No XP will be awarded",
      "  - This action is recorded in your history",
    ].join("\n"),
    "Consequences",
  );

  const confirm = await p.confirm({
    message: `Really abandon "${quest.title}"?`,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.cancel(abandonCancelled());
    return;
  }

  await updateQuestStatus(db, quest.id, user.id, "abandoned");
  p.log.warn(questAbandoned(quest.streakCount));
}
