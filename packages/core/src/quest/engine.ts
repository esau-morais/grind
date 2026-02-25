import {
  type CreateQuestInput,
  type Quest,
  type QuestStatus,
  createQuestInputSchema,
  questSchema,
} from "../schema";

import { assertQuestTransition } from "./state-machine";

function now(): number {
  return Date.now();
}

export function createQuestEntity(input: CreateQuestInput): Quest {
  const valid = createQuestInputSchema.parse(input);
  const timestamp = now();

  return questSchema.parse({
    ...valid,
    id: crypto.randomUUID(),
    status: valid.status ?? "available",
    streakCount: valid.streakCount ?? 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function transitionQuestStatus(quest: Quest, to: QuestStatus, at = now()): Quest {
  assertQuestTransition(quest.status, to);

  return questSchema.parse({
    ...quest,
    status: to,
    completedAt: to === "completed" ? at : undefined,
    updatedAt: at,
  });
}

export function completeObjective(quest: Quest, objectiveId: string): Quest {
  const updatedObjectives = quest.objectives.map((objective) =>
    objective.id === objectiveId ? { ...objective, completed: true } : objective,
  );
  const allCompleted =
    updatedObjectives.length > 0 && updatedObjectives.every((item) => item.completed);

  const nextQuest: Quest = {
    ...quest,
    objectives: updatedObjectives,
    updatedAt: now(),
  };

  return allCompleted
    ? transitionQuestStatus(nextQuest, "completed")
    : questSchema.parse(nextQuest);
}

export function resetQuestStreak(quest: Quest): Quest {
  return questSchema.parse({
    ...quest,
    streakCount: 0,
    updatedAt: now(),
  });
}
