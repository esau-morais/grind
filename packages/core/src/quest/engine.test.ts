import { describe, expect, test } from "bun:test";

import {
  completeObjective,
  createQuestEntity,
  resetQuestStreak,
  transitionQuestStatus,
} from "./engine";

describe("createQuestEntity", () => {
  test("creates a valid quest with required fields", () => {
    const quest = createQuestEntity({
      userId: "user-1",
      title: "Morning Workout",
      type: "daily",
      difficulty: "medium",
      skillTags: ["fitness"],
      baseXp: 20,
      objectives: [],
      metadata: {},
    });

    expect(quest.id).toBeString();
    expect(quest.id.length).toBeGreaterThan(0);
    expect(quest.userId).toBe("user-1");
    expect(quest.title).toBe("Morning Workout");
    expect(quest.type).toBe("daily");
    expect(quest.difficulty).toBe("medium");
    expect(quest.status).toBe("available");
    expect(quest.streakCount).toBe(0);
    expect(quest.baseXp).toBe(20);
    expect(quest.createdAt).toBeNumber();
    expect(quest.updatedAt).toBeNumber();
  });

  test("assigns a UUID for id", () => {
    const q1 = createQuestEntity({
      userId: "user-1",
      title: "Quest A",
      type: "bounty",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
      objectives: [],
      metadata: {},
    });
    const q2 = createQuestEntity({
      userId: "user-1",
      title: "Quest B",
      type: "bounty",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
      objectives: [],
      metadata: {},
    });
    expect(q1.id).not.toBe(q2.id);
  });

  test("status defaults to available", () => {
    const quest = createQuestEntity({
      userId: "user-1",
      title: "Test",
      type: "daily",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
      objectives: [],
      metadata: {},
    });
    expect(quest.status).toBe("available");
  });

  test("allows overriding status", () => {
    const quest = createQuestEntity({
      userId: "user-1",
      title: "Test",
      type: "daily",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
      objectives: [],
      metadata: {},
      status: "active",
    });
    expect(quest.status).toBe("active");
  });

  test("rejects invalid type", () => {
    expect(() =>
      createQuestEntity({
        userId: "user-1",
        title: "Test",
        type: "invalid" as never,
        difficulty: "easy",
        skillTags: [],
        baseXp: 10,
        objectives: [],
        metadata: {},
      }),
    ).toThrow();
  });

  test("rejects empty title", () => {
    expect(() =>
      createQuestEntity({
        userId: "user-1",
        title: "",
        type: "daily",
        difficulty: "easy",
        skillTags: [],
        baseXp: 10,
        objectives: [],
        metadata: {},
      }),
    ).toThrow();
  });

  test("createdAt and updatedAt are close to Date.now()", () => {
    const before = Date.now();
    const quest = createQuestEntity({
      userId: "user-1",
      title: "Timing Test",
      type: "bounty",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
      objectives: [],
      metadata: {},
    });
    const after = Date.now();
    expect(quest.createdAt).toBeGreaterThanOrEqual(before);
    expect(quest.createdAt).toBeLessThanOrEqual(after);
  });
});

describe("transitionQuestStatus", () => {
  function makeQuest(status: "available" | "active" | "completed" | "failed" | "abandoned") {
    return createQuestEntity({
      userId: "user-1",
      title: "Test Quest",
      type: "daily",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
      objectives: [],
      metadata: {},
      status,
    });
  }

  test("available → active: sets new status", () => {
    const quest = makeQuest("available");
    const updated = transitionQuestStatus(quest, "active");
    expect(updated.status).toBe("active");
  });

  test("active → completed: sets completedAt", () => {
    const quest = makeQuest("active");
    const before = Date.now();
    const updated = transitionQuestStatus(quest, "completed");
    expect(updated.status).toBe("completed");
    expect(updated.completedAt).toBeDefined();
    expect(updated.completedAt).toBeGreaterThanOrEqual(before);
  });

  test("active → completed: allows custom timestamp", () => {
    const quest = makeQuest("active");
    const at = 1700000000000;
    const updated = transitionQuestStatus(quest, "completed", at);
    expect(updated.completedAt).toBe(at);
  });

  test("non-completed transition: completedAt not set", () => {
    const quest = makeQuest("available");
    const updated = transitionQuestStatus(quest, "active");
    expect(updated.completedAt).toBeUndefined();
  });

  test("invalid transition: throws", () => {
    const quest = makeQuest("completed");
    expect(() => transitionQuestStatus(quest, "active")).toThrow();
  });

  test("updatedAt is updated", () => {
    const quest = makeQuest("available");
    const before = Date.now();
    const updated = transitionQuestStatus(quest, "active");
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("completeObjective", () => {
  function makeQuestWithObjectives() {
    const quest = createQuestEntity({
      userId: "user-1",
      title: "Morning Routine",
      type: "daily",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
      objectives: [
        { id: "obj-1", label: "Read", completed: false, xpReward: 5 },
        { id: "obj-2", label: "Exercise", completed: false, xpReward: 5 },
        { id: "obj-3", label: "Meditate", completed: false, xpReward: 5 },
      ],
      metadata: {},
      status: "active",
    });
    return quest;
  }

  test("marks the target objective as completed", () => {
    const quest = makeQuestWithObjectives();
    const updated = completeObjective(quest, "obj-1");
    const obj = updated.objectives.find((o) => o.id === "obj-1");
    expect(obj?.completed).toBe(true);
  });

  test("leaves other objectives unchanged", () => {
    const quest = makeQuestWithObjectives();
    const updated = completeObjective(quest, "obj-1");
    expect(updated.objectives.find((o) => o.id === "obj-2")?.completed).toBe(false);
    expect(updated.objectives.find((o) => o.id === "obj-3")?.completed).toBe(false);
  });

  test("quest not completed when objectives remain", () => {
    const quest = makeQuestWithObjectives();
    const updated = completeObjective(quest, "obj-1");
    expect(updated.status).toBe("active");
  });

  test("quest auto-completes when all objectives done", () => {
    let quest = makeQuestWithObjectives();
    quest = completeObjective(quest, "obj-1");
    quest = completeObjective(quest, "obj-2");
    quest = completeObjective(quest, "obj-3");
    expect(quest.status).toBe("completed");
  });

  test("unknown objectiveId: no change to any objective", () => {
    const quest = makeQuestWithObjectives();
    const updated = completeObjective(quest, "nonexistent");
    expect(updated.objectives.every((o) => !o.completed)).toBe(true);
    expect(updated.status).toBe("active");
  });

  test("quest with no objectives: completeObjective does not auto-complete", () => {
    const quest = createQuestEntity({
      userId: "user-1",
      title: "No Objectives",
      type: "bounty",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
      objectives: [],
      metadata: {},
      status: "active",
    });
    const updated = completeObjective(quest, "any");
    expect(updated.status).toBe("active");
  });
});

describe("resetQuestStreak", () => {
  test("resets streakCount to 0", () => {
    const quest = createQuestEntity({
      userId: "user-1",
      title: "Streak Quest",
      type: "daily",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
      objectives: [],
      metadata: {},
      streakCount: 42,
    });
    const reset = resetQuestStreak(quest);
    expect(reset.streakCount).toBe(0);
  });

  test("does not change other fields", () => {
    const quest = createQuestEntity({
      userId: "user-1",
      title: "Streak Quest",
      type: "daily",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
      objectives: [],
      metadata: {},
      streakCount: 42,
    });
    const reset = resetQuestStreak(quest);
    expect(reset.title).toBe(quest.title);
    expect(reset.userId).toBe(quest.userId);
    expect(reset.id).toBe(quest.id);
  });
});
