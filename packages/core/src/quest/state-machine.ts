import type { QuestStatus } from "../schema";

const questTransitions: Record<QuestStatus, QuestStatus[]> = {
  available: ["active", "abandoned"],
  active: ["completed", "failed", "abandoned"],
  completed: [],
  failed: ["available", "abandoned"],
  abandoned: ["available"],
};

export function canTransitionQuestStatus(from: QuestStatus, to: QuestStatus): boolean {
  return questTransitions[from].includes(to);
}

export function assertQuestTransition(from: QuestStatus, to: QuestStatus): void {
  if (!canTransitionQuestStatus(from, to)) {
    throw new Error(`Invalid quest status transition: ${from} -> ${to}`);
  }
}
