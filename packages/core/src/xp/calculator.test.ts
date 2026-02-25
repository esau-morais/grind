import { describe, expect, test } from "bun:test";

import { calculateQuestXp, levelFromXp, skillLevelFromXp, xpForLevel } from "./calculator";
import { SKILL_LEVEL_THRESHOLDS } from "./constants";

describe("calculateQuestXp", () => {
  test("self-report easy: 1x multiplier, no streak", () => {
    const result = calculateQuestXp({
      baseXp: 20,
      difficulty: "easy",
      streakDays: 0,
      proofType: "self-report",
    });
    expect(result.scaledBaseXp).toBe(20);
    expect(result.streakBonus).toBe(0);
    expect(result.proofBonus).toBe(0);
    expect(result.totalXp).toBe(20);
  });

  test("medium difficulty scales base by 1.5x", () => {
    const result = calculateQuestXp({
      baseXp: 20,
      difficulty: "medium",
      streakDays: 0,
      proofType: "self-report",
    });
    expect(result.scaledBaseXp).toBe(30);
    expect(result.totalXp).toBe(30);
  });

  test("hard difficulty scales base by 2.5x", () => {
    const result = calculateQuestXp({
      baseXp: 20,
      difficulty: "hard",
      streakDays: 0,
      proofType: "self-report",
    });
    expect(result.scaledBaseXp).toBe(50);
  });

  test("epic difficulty scales base by 4x", () => {
    const result = calculateQuestXp({
      baseXp: 25,
      difficulty: "epic",
      streakDays: 0,
      proofType: "self-report",
    });
    expect(result.scaledBaseXp).toBe(100);
  });

  test("duration proof gives 1.5x proof bonus on scaled base", () => {
    const result = calculateQuestXp({
      baseXp: 20,
      difficulty: "easy",
      streakDays: 0,
      proofType: "duration",
    });
    expect(result.proofBonus).toBe(10);
    expect(result.totalXp).toBe(30);
  });

  test("ai-verify gives 1.75x proof bonus", () => {
    const result = calculateQuestXp({
      baseXp: 20,
      difficulty: "easy",
      streakDays: 0,
      proofType: "ai-verify",
    });
    expect(result.proofBonus).toBe(15);
    expect(result.totalXp).toBe(35);
  });

  test("multi-proof gives 2.0x (doubles the base)", () => {
    const result = calculateQuestXp({
      baseXp: 20,
      difficulty: "easy",
      streakDays: 0,
      proofType: "multi-proof",
    });
    expect(result.proofBonus).toBe(20);
    expect(result.totalXp).toBe(40);
  });

  test("streak bonus: floor(days * 0.5)", () => {
    const result = calculateQuestXp({
      baseXp: 20,
      difficulty: "easy",
      streakDays: 10,
      proofType: "self-report",
    });
    expect(result.streakBonus).toBe(5);
    expect(result.totalXp).toBe(25);
  });

  test("streak bonus caps at 25 regardless of streak length", () => {
    const result = calculateQuestXp({
      baseXp: 20,
      difficulty: "easy",
      streakDays: 200,
      proofType: "self-report",
    });
    expect(result.streakBonus).toBe(25);
  });

  test("streak cap: exactly 50 days gives 25 (cap boundary)", () => {
    const at50 = calculateQuestXp({
      baseXp: 20,
      difficulty: "easy",
      streakDays: 50,
      proofType: "self-report",
    });
    const at51 = calculateQuestXp({
      baseXp: 20,
      difficulty: "easy",
      streakDays: 51,
      proofType: "self-report",
    });
    expect(at50.streakBonus).toBe(25);
    expect(at51.streakBonus).toBe(25);
  });

  test("combined: epic hard + timer + 14d streak", () => {
    const result = calculateQuestXp({
      baseXp: 25,
      difficulty: "hard",
      streakDays: 14,
      proofType: "duration",
    });
    const scaledBase = Math.round(25 * 2.5);
    const streakBonus = Math.floor(14 * 0.5);
    const proofBonus = Math.round(scaledBase * (1.5 - 1));
    expect(result.scaledBaseXp).toBe(scaledBase);
    expect(result.streakBonus).toBe(streakBonus);
    expect(result.proofBonus).toBe(proofBonus);
    expect(result.totalXp).toBe(scaledBase + streakBonus + proofBonus);
  });

  test("rejects invalid difficulty", () => {
    expect(() =>
      calculateQuestXp({
        baseXp: 20,
        difficulty: "legendary" as never,
        streakDays: 0,
        proofType: "self-report",
      }),
    ).toThrow();
  });

  test("rejects negative baseXp", () => {
    expect(() =>
      calculateQuestXp({
        baseXp: -10,
        difficulty: "easy",
        streakDays: 0,
        proofType: "self-report",
      }),
    ).toThrow();
  });

  test("rejects zero baseXp", () => {
    expect(() =>
      calculateQuestXp({
        baseXp: 0,
        difficulty: "easy",
        streakDays: 0,
        proofType: "self-report",
      }),
    ).toThrow();
  });

  test("rejects negative streakDays", () => {
    expect(() =>
      calculateQuestXp({
        baseXp: 20,
        difficulty: "easy",
        streakDays: -1,
        proofType: "self-report",
      }),
    ).toThrow();
  });

  test("timestamp proof: 1.1x bonus", () => {
    const result = calculateQuestXp({
      baseXp: 20,
      difficulty: "easy",
      streakDays: 0,
      proofType: "timestamp",
    });
    expect(result.proofBonus).toBe(2);
  });

  test("screenshot proof: 1.25x bonus", () => {
    const result = calculateQuestXp({
      baseXp: 20,
      difficulty: "easy",
      streakDays: 0,
      proofType: "screenshot",
    });
    expect(result.proofBonus).toBe(5);
  });

  test("git-commit proof: 1.5x bonus (same as duration)", () => {
    const result = calculateQuestXp({
      baseXp: 20,
      difficulty: "easy",
      streakDays: 0,
      proofType: "git-commit",
    });
    expect(result.proofBonus).toBe(10);
  });
});

describe("levelFromXp", () => {
  test("0 XP = level 1", () => {
    expect(levelFromXp(0)).toBe(1);
  });

  test("negative XP = level 1", () => {
    expect(levelFromXp(-100)).toBe(1);
  });

  test("just below level 2 threshold (300) = level 1", () => {
    expect(levelFromXp(299)).toBe(1);
  });

  test("exactly at level 2 threshold (300) = level 2", () => {
    expect(levelFromXp(300)).toBe(2);
  });

  test("level thresholds follow 50*n^2 + 50*n", () => {
    // level 1 = 0 (special-cased in code)
    // level 2 = 50*4 + 50*2 = 300
    // level 3 = 50*9 + 50*3 = 600
    // level 4 = 50*16 + 50*4 = 1000
    // level 5 = 50*25 + 50*5 = 1500
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(299)).toBe(1);
    expect(levelFromXp(300)).toBe(2);
    expect(levelFromXp(599)).toBe(2);
    expect(levelFromXp(600)).toBe(3);
    expect(levelFromXp(999)).toBe(3);
    expect(levelFromXp(1000)).toBe(4);
    expect(levelFromXp(1499)).toBe(4);
    expect(levelFromXp(1500)).toBe(5);
  });

  test("level 10 threshold", () => {
    const lv10 = 50 * 100 + 50 * 10;
    expect(levelFromXp(lv10)).toBe(10);
    expect(levelFromXp(lv10 - 1)).toBe(9);
  });
});

describe("xpForLevel", () => {
  test("level 1 requires 0 XP", () => {
    expect(xpForLevel(1)).toBe(0);
  });

  test("level 2 requires 300 XP", () => {
    expect(xpForLevel(2)).toBe(300);
  });

  test("level 3 requires 600 XP", () => {
    expect(xpForLevel(3)).toBe(600);
  });

  test("level 4 requires 1000 XP", () => {
    expect(xpForLevel(4)).toBe(1000);
  });

  test("level 5 requires 1500 XP", () => {
    expect(xpForLevel(5)).toBe(1500);
  });
});

describe("skillLevelFromXp", () => {
  test("0 XP = skill level 0", () => {
    expect(skillLevelFromXp(0)).toBe(0);
  });

  test("below threshold[1] (100) = level 0", () => {
    expect(skillLevelFromXp(99)).toBe(0);
  });

  test("exactly at threshold[1] (100) = level 1", () => {
    expect(skillLevelFromXp(SKILL_LEVEL_THRESHOLDS[1])).toBe(1);
  });

  test("at threshold[2] (300) = level 2", () => {
    expect(skillLevelFromXp(SKILL_LEVEL_THRESHOLDS[2])).toBe(2);
  });

  test("at threshold[3] (600) = level 3", () => {
    expect(skillLevelFromXp(SKILL_LEVEL_THRESHOLDS[3])).toBe(3);
  });

  test("at threshold[4] (1000) = level 4", () => {
    expect(skillLevelFromXp(SKILL_LEVEL_THRESHOLDS[4])).toBe(4);
  });

  test("at threshold[5] (1500) = level 5", () => {
    expect(skillLevelFromXp(SKILL_LEVEL_THRESHOLDS[5])).toBe(5);
  });

  test("above threshold[5] stays at level 5", () => {
    expect(skillLevelFromXp(99999)).toBe(5);
  });

  test("negative XP clamped to level 0", () => {
    expect(skillLevelFromXp(-500)).toBe(0);
  });
});
