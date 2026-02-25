import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createTestUser, createTestVault, type TestVault } from "../../test-helpers";
import {
  addXpToSkill,
  createSkill,
  distributeSkillXp,
  getSkillByName,
  getSkillById,
  listSkillsByUser,
  upsertSkillByTag,
} from "./skills";
import { SKILL_LEVEL_THRESHOLDS } from "../../xp/constants";

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

describe("createSkill", () => {
  test("creates a skill with defaults", async () => {
    const skill = await createSkill(vault.db, { userId, name: "Fitness", category: "fitness" });
    expect(skill.id).toBeString();
    expect(skill.userId).toBe(userId);
    expect(skill.name).toBe("Fitness");
    expect(skill.category).toBe("fitness");
    expect(skill.xp).toBe(0);
    expect(skill.level).toBe(0);
  });
});

describe("getSkillById", () => {
  test("returns skill by id", async () => {
    const created = await createSkill(vault.db, { userId, name: "Coding", category: "academics" });
    const found = await getSkillById(vault.db, created.id);
    expect(found?.id).toBe(created.id);
  });

  test("returns null for unknown id", async () => {
    expect(await getSkillById(vault.db, "nope")).toBeNull();
  });
});

describe("getSkillByName", () => {
  test("returns skill by user+name", async () => {
    await createSkill(vault.db, { userId, name: "Reading", category: "life" });
    const found = await getSkillByName(vault.db, userId, "Reading");
    expect(found?.name).toBe("Reading");
  });

  test("returns null for wrong user", async () => {
    const other = await createTestUser(vault.db, { displayName: "Other" });
    await createSkill(vault.db, { userId: other.id, name: "Reading", category: "life" });
    expect(await getSkillByName(vault.db, userId, "Reading")).toBeNull();
  });
});

describe("listSkillsByUser", () => {
  test("returns all skills for user sorted by XP descending", async () => {
    const low = await createSkill(vault.db, { userId, name: "Low", category: "life" });
    const high = await createSkill(vault.db, { userId, name: "High", category: "life" });
    await addXpToSkill(vault.db, high.id, 500);
    await addXpToSkill(vault.db, low.id, 10);

    const skills = await listSkillsByUser(vault.db, userId);
    expect(skills[0]?.name).toBe("High");
    expect(skills[1]?.name).toBe("Low");
  });
});

describe("addXpToSkill", () => {
  test("increments XP", async () => {
    const skill = await createSkill(vault.db, { userId, name: "Music", category: "music" });
    const updated = await addXpToSkill(vault.db, skill.id, 50);
    expect(updated.xp).toBe(50);
  });

  test("level-up at XP threshold[1] (100)", async () => {
    const skill = await createSkill(vault.db, { userId, name: "Guitar", category: "music" });
    const updated = await addXpToSkill(vault.db, skill.id, SKILL_LEVEL_THRESHOLDS[1]);
    expect(updated.level).toBe(1);
  });

  test("level-up at XP threshold[2] (300)", async () => {
    const skill = await createSkill(vault.db, { userId, name: "Bass", category: "music" });
    const updated = await addXpToSkill(vault.db, skill.id, SKILL_LEVEL_THRESHOLDS[2]);
    expect(updated.level).toBe(2);
  });

  test("negative XP cannot go below 0", async () => {
    const skill = await createSkill(vault.db, { userId, name: "Test", category: "life" });
    const updated = await addXpToSkill(vault.db, skill.id, -999);
    expect(updated.xp).toBe(0);
  });

  test("throws for unknown skillId", async () => {
    await expect(addXpToSkill(vault.db, "nonexistent", 10)).rejects.toThrow("Skill not found");
  });
});

describe("upsertSkillByTag", () => {
  test('creates skill from "category:name" tag format', async () => {
    const skill = await upsertSkillByTag(vault.db, userId, "fitness:strength");
    expect(skill.name).toBe("strength");
    expect(skill.category).toBe("fitness");
  });

  test("creates skill with default category for plain tag", async () => {
    const skill = await upsertSkillByTag(vault.db, userId, "discipline");
    expect(skill.name).toBe("discipline");
    expect(skill.category).toBe("life");
  });

  test("returns existing skill on second upsert (idempotent)", async () => {
    const first = await upsertSkillByTag(vault.db, userId, "coding");
    const second = await upsertSkillByTag(vault.db, userId, "coding");
    expect(first.id).toBe(second.id);
  });

  test('unknown category falls back to "life"', async () => {
    const skill = await upsertSkillByTag(vault.db, userId, "unknowncategory:skill");
    expect(skill.category).toBe("life");
  });
});

describe("distributeSkillXp", () => {
  test("empty tags: no gains", async () => {
    const gains = await distributeSkillXp(vault.db, userId, [], 100);
    expect(gains).toHaveLength(0);
  });

  test("zero xp: no gains", async () => {
    const gains = await distributeSkillXp(vault.db, userId, ["fitness"], 0);
    expect(gains).toHaveLength(0);
  });

  test("single tag: receives all XP", async () => {
    const gains = await distributeSkillXp(vault.db, userId, ["fitness"], 20);
    expect(gains).toHaveLength(1);
    expect(gains[0]?.xpGained).toBe(20);
  });

  test("two tags: primary gets 50%, secondary gets remainder", async () => {
    const gains = await distributeSkillXp(vault.db, userId, ["fitness", "discipline"], 20);
    expect(gains).toHaveLength(2);
    expect(gains[0]?.xpGained).toBe(10);
    expect(gains[1]?.xpGained).toBe(10);
  });

  test("three tags: primary 50%, remaining split equally", async () => {
    const gains = await distributeSkillXp(vault.db, userId, ["a", "b", "c"], 20);
    const total = gains.reduce((s, g) => s + g.xpGained, 0);
    expect(total).toBe(20);
    expect(gains[0]?.xpGained).toBe(10);
  });

  test("leveledUp is true when XP crosses threshold", async () => {
    const gains = await distributeSkillXp(vault.db, userId, ["skill"], SKILL_LEVEL_THRESHOLDS[1]);
    expect(gains[0]?.leveledUp).toBe(true);
    expect(gains[0]?.levelAfter).toBe(1);
  });

  test("leveledUp is false when below threshold", async () => {
    const gains = await distributeSkillXp(vault.db, userId, ["skill"], 50);
    expect(gains[0]?.leveledUp).toBe(false);
    expect(gains[0]?.levelAfter).toBe(0);
  });
});
