import { describe, expect, test } from "bun:test";

import {
  applyStreakPenalty,
  calculateStreakInfo,
  formatStreakDisplay,
  getStreakTier,
} from "./streak";

describe("getStreakTier", () => {
  test("0 days = null (no streak)", () => {
    expect(getStreakTier(0)).toBeNull();
  });

  test("negative days = null", () => {
    expect(getStreakTier(-1)).toBeNull();
  });

  test("1 day = Spark", () => {
    expect(getStreakTier(1)?.name).toBe("Spark");
  });

  test("7 days = Spark (boundary)", () => {
    expect(getStreakTier(7)?.name).toBe("Spark");
  });

  test("8 days = Flame (crosses boundary)", () => {
    expect(getStreakTier(8)?.name).toBe("Flame");
  });

  test("14 days = Flame (boundary)", () => {
    expect(getStreakTier(14)?.name).toBe("Flame");
  });

  test("15 days = Fire (crosses boundary)", () => {
    expect(getStreakTier(15)?.name).toBe("Fire");
  });

  test("30 days = Fire (boundary)", () => {
    expect(getStreakTier(30)?.name).toBe("Fire");
  });

  test("31 days = Blaze (crosses boundary)", () => {
    expect(getStreakTier(31)?.name).toBe("Blaze");
  });

  test("60 days = Blaze (boundary)", () => {
    expect(getStreakTier(60)?.name).toBe("Blaze");
  });

  test("61 days = Inferno (crosses boundary)", () => {
    expect(getStreakTier(61)?.name).toBe("Inferno");
  });

  test("90 days = Inferno (boundary)", () => {
    expect(getStreakTier(90)?.name).toBe("Inferno");
  });

  test("91 days = Eternal Fire (crosses boundary)", () => {
    expect(getStreakTier(91)?.name).toBe("Eternal Fire");
  });

  test("1000 days = Eternal Fire (no upper bound)", () => {
    expect(getStreakTier(1000)?.name).toBe("Eternal Fire");
  });

  test("bonus per day increases with tier", () => {
    expect(getStreakTier(1)?.bonusPerDay).toBe(0.5);
    expect(getStreakTier(8)?.bonusPerDay).toBe(1.0);
    expect(getStreakTier(15)?.bonusPerDay).toBe(1.5);
    expect(getStreakTier(31)?.bonusPerDay).toBe(2.0);
    expect(getStreakTier(61)?.bonusPerDay).toBe(3.0);
    expect(getStreakTier(91)?.bonusPerDay).toBe(5.0);
  });
});

describe("calculateStreakInfo", () => {
  test("0 days = none tier, zero bonus", () => {
    const info = calculateStreakInfo(0);
    expect(info.count).toBe(0);
    expect(info.tierName).toBe("None");
    expect(info.bonusPerDay).toBe(0);
    expect(info.totalBonus).toBe(0);
    expect(info.shieldsEarned).toBe(0);
  });

  test("14 days: totalBonus = floor(14 * 0.5) = 7", () => {
    const info = calculateStreakInfo(14);
    expect(info.totalBonus).toBe(7);
  });

  test("totalBonus caps at 25", () => {
    expect(calculateStreakInfo(50).totalBonus).toBe(25);
    expect(calculateStreakInfo(51).totalBonus).toBe(25);
    expect(calculateStreakInfo(1000).totalBonus).toBe(25);
  });

  test("shields: 0 at 29 days", () => {
    expect(calculateStreakInfo(29).shieldsEarned).toBe(0);
  });

  test("shields: 1 at 30 days", () => {
    expect(calculateStreakInfo(30).shieldsEarned).toBe(1);
  });

  test("shields: 2 at 60 days", () => {
    expect(calculateStreakInfo(60).shieldsEarned).toBe(2);
  });

  test("shields: 3 at 90 days", () => {
    expect(calculateStreakInfo(90).shieldsEarned).toBe(3);
  });

  test("tierName matches streak tier", () => {
    expect(calculateStreakInfo(7).tierName).toBe("Spark");
    expect(calculateStreakInfo(8).tierName).toBe("Flame");
    expect(calculateStreakInfo(91).tierName).toBe("Eternal Fire");
  });
});

describe("applyStreakPenalty", () => {
  test("0 days missed: no change", () => {
    expect(applyStreakPenalty(30, 0)).toBe(30);
  });

  test("negative days missed: no change (treated as 0)", () => {
    expect(applyStreakPenalty(30, -5)).toBe(30);
  });

  test("1 day missed: grace period, no change", () => {
    expect(applyStreakPenalty(30, 1)).toBe(30);
  });

  test("2 days missed: streak halved (floor)", () => {
    expect(applyStreakPenalty(30, 2)).toBe(15);
    expect(applyStreakPenalty(31, 2)).toBe(15);
    expect(applyStreakPenalty(1, 2)).toBe(0);
  });

  test("3 days missed: streak reset to 0", () => {
    expect(applyStreakPenalty(100, 3)).toBe(0);
  });

  test("more than 3 days missed: streak reset to 0", () => {
    expect(applyStreakPenalty(100, 10)).toBe(0);
  });

  test("streak of 0: stays 0 regardless of penalty", () => {
    expect(applyStreakPenalty(0, 2)).toBe(0);
    expect(applyStreakPenalty(0, 3)).toBe(0);
  });
});

describe("formatStreakDisplay", () => {
  test('0 or less = "No streak"', () => {
    expect(formatStreakDisplay(0)).toBe("No streak");
    expect(formatStreakDisplay(-1)).toBe("No streak");
  });

  test("positive days: shows count and tier name", () => {
    const display = formatStreakDisplay(7);
    expect(display).toContain("7d");
    expect(display).toContain("Spark");
  });

  test("shows Eternal Fire for 91+", () => {
    const display = formatStreakDisplay(91);
    expect(display).toContain("91d");
    expect(display).toContain("Eternal Fire");
  });
});
