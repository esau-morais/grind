import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { clearTimer, formatElapsed, getElapsedMinutes, readTimer, writeTimer } from "./timer";

let tmpDir: string;
let timerPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "grind-timer-"));
  timerPath = join(tmpDir, "timer.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("readTimer", () => {
  test("returns null when file does not exist", () => {
    expect(readTimer(timerPath)).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    import("node:fs").then(({ writeFileSync }) => writeFileSync(timerPath, "not-json"));
    expect(readTimer(timerPath)).toBeNull();
  });

  test("returns null when schema validation fails", () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(timerPath, JSON.stringify({ invalid: true }));
    expect(readTimer(timerPath)).toBeNull();
  });

  test("returns TimerState for valid file", () => {
    const { writeFileSync } = require("node:fs");
    const state = {
      questId: "quest-1",
      questTitle: "Morning Run",
      userId: "user-1",
      startedAt: 1_000_000,
    };
    writeFileSync(timerPath, JSON.stringify(state));
    const result = readTimer(timerPath);
    expect(result).toEqual(state);
  });
});

describe("writeTimer + readTimer roundtrip", () => {
  test("writes and reads back the same state", () => {
    const state = {
      questId: "q-abc",
      questTitle: "Workout",
      userId: "u-xyz",
      startedAt: 1_700_000_000_000,
    };
    writeTimer(timerPath, state);
    const result = readTimer(timerPath);
    expect(result).toEqual(state);
  });
});

describe("clearTimer", () => {
  test("removes the timer file", () => {
    const { writeFileSync, existsSync } = require("node:fs");
    writeFileSync(
      timerPath,
      JSON.stringify({ questId: "q", questTitle: "t", userId: "u", startedAt: 1 }),
    );
    clearTimer(timerPath);
    expect(existsSync(timerPath)).toBe(false);
  });

  test("no-ops when file does not exist", () => {
    expect(() => clearTimer(timerPath)).not.toThrow();
  });
});

describe("getElapsedMinutes", () => {
  test("returns 0 for just-started timer", () => {
    const elapsed = getElapsedMinutes(Date.now());
    expect(elapsed).toBe(0);
  });

  test("returns correct minutes for past startedAt", () => {
    const startedAt = Date.now() - 30 * 60 * 1000;
    const elapsed = getElapsedMinutes(startedAt);
    expect(elapsed).toBe(30);
  });

  test("rounds to nearest minute", () => {
    const startedAt = Date.now() - 90 * 1000;
    const elapsed = getElapsedMinutes(startedAt);
    expect(elapsed).toBe(2);
  });
});

describe("formatElapsed", () => {
  test("shows minutes for under 1 hour", () => {
    const startedAt = Date.now() - 45 * 60 * 1000;
    expect(formatElapsed(startedAt)).toBe("45m");
  });

  test("shows hours and minutes for >= 1 hour with remainder", () => {
    const startedAt = Date.now() - 90 * 60 * 1000;
    expect(formatElapsed(startedAt)).toBe("1h 30m");
  });

  test("shows only hours when no remainder", () => {
    const startedAt = Date.now() - 120 * 60 * 1000;
    expect(formatElapsed(startedAt)).toBe("2h");
  });

  test("shows 0m for just-started timer", () => {
    expect(formatElapsed(Date.now())).toBe("0m");
  });
});
