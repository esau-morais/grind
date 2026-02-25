import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createTestUser, createTestVault, type TestVault } from "../../test-helpers";
import {
  completeQuest,
  createQuest,
  findQuestByPrefix,
  getQuestById,
  listQuestsByUser,
  updateQuestStatus,
} from "./quests";

let vault: TestVault;
let userId: string;

beforeEach(async () => {
  vault = await createTestVault();
  const user = await createTestUser(vault.db);
  userId = user.id;
});

afterEach(() => {
  vault.close();
});

function baseQuestInput(title = "Test Quest") {
  return {
    userId,
    title,
    type: "bounty" as const,
    difficulty: "easy" as const,
    skillTags: [] as string[],
    baseXp: 10,
    objectives: [] as never[],
    metadata: {},
  };
}

describe("createQuest", () => {
  test("creates a quest with generated id and timestamps", async () => {
    const quest = await createQuest(vault.db, baseQuestInput());
    expect(quest.id).toBeString();
    expect(quest.id.length).toBeGreaterThan(0);
    expect(quest.title).toBe("Test Quest");
    expect(quest.userId).toBe(userId);
    expect(quest.createdAt).toBeNumber();
    expect(quest.updatedAt).toBeNumber();
  });

  test("new quests are created with active status", async () => {
    const quest = await createQuest(vault.db, baseQuestInput());
    expect(quest.status).toBe("active");
  });

  test("stores skill tags correctly", async () => {
    const quest = await createQuest(vault.db, {
      ...baseQuestInput(),
      skillTags: ["fitness:strength", "discipline"],
    });
    expect(quest.skillTags).toEqual(["fitness:strength", "discipline"]);
  });

  test("stores objectives correctly", async () => {
    const quest = await createQuest(vault.db, {
      ...baseQuestInput(),
      objectives: [
        { id: "obj-1", label: "Step 1", completed: false, xpReward: 5 },
        { id: "obj-2", label: "Step 2", completed: false, xpReward: 5 },
      ],
    });
    expect(quest.objectives).toHaveLength(2);
    expect(quest.objectives[0]?.label).toBe("Step 1");
  });
});

describe("getQuestById", () => {
  test("returns quest by exact id", async () => {
    const created = await createQuest(vault.db, baseQuestInput("Find Me"));
    const found = await getQuestById(vault.db, created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.title).toBe("Find Me");
  });

  test("returns null for nonexistent id", async () => {
    const found = await getQuestById(vault.db, "nonexistent-id");
    expect(found).toBeNull();
  });
});

describe("findQuestByPrefix", () => {
  test("finds quest by id prefix", async () => {
    const quest = await createQuest(vault.db, baseQuestInput("Prefix Quest"));
    const prefix = quest.id.slice(0, 6);
    const found = await findQuestByPrefix(vault.db, userId, prefix);
    expect(found?.id).toBe(quest.id);
  });

  test("finds quest by title substring (case-insensitive)", async () => {
    await createQuest(vault.db, baseQuestInput("Morning Workout"));
    const found = await findQuestByPrefix(vault.db, userId, "workout");
    expect(found?.title).toBe("Morning Workout");
  });

  test("returns null when no match", async () => {
    const found = await findQuestByPrefix(vault.db, userId, "xyz-not-found");
    expect(found).toBeNull();
  });

  test("does not return quests from other users", async () => {
    const otherUser = await createTestUser(vault.db, { displayName: "Other User" });
    await createQuest(vault.db, { ...baseQuestInput("Private Quest"), userId: otherUser.id });
    const found = await findQuestByPrefix(vault.db, userId, "Private Quest");
    expect(found).toBeNull();
  });
});

describe("listQuestsByUser", () => {
  test("returns all quests for user", async () => {
    await createQuest(vault.db, baseQuestInput("Quest 1"));
    await createQuest(vault.db, baseQuestInput("Quest 2"));
    const quests = await listQuestsByUser(vault.db, userId);
    expect(quests).toHaveLength(2);
  });

  test("empty list for user with no quests", async () => {
    const otherUser = await createTestUser(vault.db, { displayName: "Empty User" });
    const quests = await listQuestsByUser(vault.db, otherUser.id);
    expect(quests).toHaveLength(0);
  });

  test("does not return quests from other users", async () => {
    await createQuest(vault.db, baseQuestInput("My Quest"));
    const otherUser = await createTestUser(vault.db, { displayName: "Other" });
    await createQuest(vault.db, { ...baseQuestInput("Other Quest"), userId: otherUser.id });

    const quests = await listQuestsByUser(vault.db, userId);
    expect(quests).toHaveLength(1);
    expect(quests[0]?.title).toBe("My Quest");
  });

  test("filters by status", async () => {
    const q1 = await createQuest(vault.db, baseQuestInput("Active Quest"));
    await updateQuestStatus(vault.db, q1.id, userId, "abandoned");
    await createQuest(vault.db, baseQuestInput("Another Active"));

    const active = await listQuestsByUser(vault.db, userId, ["active"]);
    expect(active).toHaveLength(1);
    expect(active[0]?.title).toBe("Another Active");

    const abandoned = await listQuestsByUser(vault.db, userId, ["abandoned"]);
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]?.title).toBe("Active Quest");
  });

  test("filters by multiple statuses", async () => {
    const q1 = await createQuest(vault.db, baseQuestInput("Quest A"));
    await updateQuestStatus(vault.db, q1.id, userId, "abandoned");
    await createQuest(vault.db, baseQuestInput("Quest B"));

    const results = await listQuestsByUser(vault.db, userId, ["active", "abandoned"]);
    expect(results).toHaveLength(2);
  });
});

describe("updateQuestStatus", () => {
  test("changes quest status", async () => {
    const quest = await createQuest(vault.db, baseQuestInput());
    await updateQuestStatus(vault.db, quest.id, userId, "abandoned");
    const updated = await getQuestById(vault.db, quest.id);
    expect(updated?.status).toBe("abandoned");
  });

  test("sets completedAt when status = completed", async () => {
    const quest = await createQuest(vault.db, baseQuestInput());
    const before = Date.now();
    await updateQuestStatus(vault.db, quest.id, userId, "completed");
    const updated = await getQuestById(vault.db, quest.id);
    expect(updated?.completedAt).toBeGreaterThanOrEqual(before);
  });

  test("resets streakCount to 0 when abandoned", async () => {
    const quest = await createQuest(vault.db, {
      ...baseQuestInput(),
      streakCount: 10,
    });
    await updateQuestStatus(vault.db, quest.id, userId, "abandoned");
    const updated = await getQuestById(vault.db, quest.id);
    expect(updated?.streakCount).toBe(0);
  });

  test("does not update quests belonging to another user", async () => {
    const otherUser = await createTestUser(vault.db, { displayName: "Stranger" });
    const quest = await createQuest(vault.db, baseQuestInput());
    await updateQuestStatus(vault.db, quest.id, otherUser.id, "abandoned");
    const unchanged = await getQuestById(vault.db, quest.id);
    expect(unchanged?.status).toBe("active");
  });
});

describe("completeQuest", () => {
  test("marks quest as completed and returns XP", async () => {
    const quest = await createQuest(vault.db, {
      ...baseQuestInput(),
      baseXp: 20,
      difficulty: "medium",
    });

    const result = await completeQuest(vault.db, {
      questId: quest.id,
      userId,
      proofType: "self-report",
      proofData: {},
    });

    expect(result.xpEarned).toBeGreaterThan(0);
    const updated = await getQuestById(vault.db, quest.id);
    expect(updated?.status).toBe("completed");
  });

  test("duration proof gives 1.5x XP vs self-report", async () => {
    const q1 = await createQuest(vault.db, {
      ...baseQuestInput("Self"),
      baseXp: 20,
      difficulty: "easy",
    });
    const q2 = await createQuest(vault.db, {
      ...baseQuestInput("Timer"),
      baseXp: 20,
      difficulty: "easy",
    });

    const self = await completeQuest(vault.db, {
      questId: q1.id,
      userId,
      proofType: "self-report",
      proofData: {},
    });
    const timed = await completeQuest(vault.db, {
      questId: q2.id,
      userId,
      proofType: "duration",
      durationMinutes: 30,
      proofData: {},
    });

    expect(timed.xpEarned).toBeGreaterThan(self.xpEarned);
  });

  test("awards XP to user totalXp", async () => {
    const { getUserById } = await import("./users");
    const before = await getUserById(vault.db, userId);
    const quest = await createQuest(vault.db, { ...baseQuestInput(), baseXp: 20 });

    const result = await completeQuest(vault.db, {
      questId: quest.id,
      userId,
      proofType: "self-report",
      proofData: {},
    });

    const after = await getUserById(vault.db, userId);
    expect(after?.totalXp).toBe((before?.totalXp ?? 0) + result.xpEarned);
  });

  test("increments streakCount by 1", async () => {
    const quest = await createQuest(vault.db, { ...baseQuestInput(), streakCount: 5 });
    await completeQuest(vault.db, {
      questId: quest.id,
      userId,
      proofType: "self-report",
      proofData: {},
    });
    const updated = await getQuestById(vault.db, quest.id);
    expect(updated?.streakCount).toBe(6);
  });

  test("distributes XP to skill tags", async () => {
    const quest = await createQuest(vault.db, {
      ...baseQuestInput(),
      skillTags: ["fitness:strength", "discipline"],
      baseXp: 20,
    });

    const result = await completeQuest(vault.db, {
      questId: quest.id,
      userId,
      proofType: "self-report",
      proofData: {},
    });

    expect(result.skillGains).toHaveLength(2);
    expect(result.skillGains.every((g) => g.xpGained > 0)).toBe(true);
  });

  test("throws when quest already completed", async () => {
    const quest = await createQuest(vault.db, baseQuestInput());
    await completeQuest(vault.db, {
      questId: quest.id,
      userId,
      proofType: "self-report",
      proofData: {},
    });

    await expect(
      completeQuest(vault.db, {
        questId: quest.id,
        userId,
        proofType: "self-report",
        proofData: {},
      }),
    ).rejects.toThrow("Quest already completed");
  });

  test("throws when quest is abandoned", async () => {
    const quest = await createQuest(vault.db, baseQuestInput());
    await updateQuestStatus(vault.db, quest.id, userId, "abandoned");

    await expect(
      completeQuest(vault.db, {
        questId: quest.id,
        userId,
        proofType: "self-report",
        proofData: {},
      }),
    ).rejects.toThrow("Cannot complete an abandoned quest");
  });

  test("throws when quest not found", async () => {
    await expect(
      completeQuest(vault.db, {
        questId: "nonexistent-id",
        userId,
        proofType: "self-report",
        proofData: {},
      }),
    ).rejects.toThrow("Quest not found");
  });

  test("level-up: user level increases when XP crosses threshold", async () => {
    const { getUserById } = await import("./users");

    // Put user at 290 XP (just below level 2 threshold of 300)
    const { addXpToUser } = await import("./users");
    await addXpToUser(vault.db, userId, 290);

    // Complete a quest worth 20 XP → 290 + 20 = 310 > 300 → level 2
    const quest = await createQuest(vault.db, { ...baseQuestInput(), baseXp: 20 });
    await completeQuest(vault.db, {
      questId: quest.id,
      userId,
      proofType: "self-report",
      proofData: {},
    });

    const after = await getUserById(vault.db, userId);
    expect(after?.level).toBeGreaterThanOrEqual(2);
  });
});
