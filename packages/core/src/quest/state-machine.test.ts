import { describe, expect, test } from "bun:test";

import { assertQuestTransition, canTransitionQuestStatus } from "./state-machine";

describe("canTransitionQuestStatus", () => {
  describe("from available", () => {
    test("→ active: allowed", () => {
      expect(canTransitionQuestStatus("available", "active")).toBe(true);
    });

    test("→ abandoned: allowed", () => {
      expect(canTransitionQuestStatus("available", "abandoned")).toBe(true);
    });

    test("→ completed: not allowed", () => {
      expect(canTransitionQuestStatus("available", "completed")).toBe(false);
    });

    test("→ failed: not allowed", () => {
      expect(canTransitionQuestStatus("available", "failed")).toBe(false);
    });
  });

  describe("from active", () => {
    test("→ completed: allowed", () => {
      expect(canTransitionQuestStatus("active", "completed")).toBe(true);
    });

    test("→ failed: allowed", () => {
      expect(canTransitionQuestStatus("active", "failed")).toBe(true);
    });

    test("→ abandoned: allowed", () => {
      expect(canTransitionQuestStatus("active", "abandoned")).toBe(true);
    });

    test("→ available: not allowed", () => {
      expect(canTransitionQuestStatus("active", "available")).toBe(false);
    });
  });

  describe("from completed", () => {
    test("→ anything: not allowed (terminal state)", () => {
      expect(canTransitionQuestStatus("completed", "active")).toBe(false);
      expect(canTransitionQuestStatus("completed", "available")).toBe(false);
      expect(canTransitionQuestStatus("completed", "failed")).toBe(false);
      expect(canTransitionQuestStatus("completed", "abandoned")).toBe(false);
    });
  });

  describe("from failed", () => {
    test("→ available: allowed (retry)", () => {
      expect(canTransitionQuestStatus("failed", "available")).toBe(true);
    });

    test("→ abandoned: allowed", () => {
      expect(canTransitionQuestStatus("failed", "abandoned")).toBe(true);
    });

    test("→ active: not allowed (must go through available)", () => {
      expect(canTransitionQuestStatus("failed", "active")).toBe(false);
    });

    test("→ completed: not allowed", () => {
      expect(canTransitionQuestStatus("failed", "completed")).toBe(false);
    });
  });

  describe("from abandoned", () => {
    test("→ available: allowed (re-commit)", () => {
      expect(canTransitionQuestStatus("abandoned", "available")).toBe(true);
    });

    test("→ active: not allowed", () => {
      expect(canTransitionQuestStatus("abandoned", "active")).toBe(false);
    });

    test("→ completed: not allowed", () => {
      expect(canTransitionQuestStatus("abandoned", "completed")).toBe(false);
    });

    test("→ failed: not allowed", () => {
      expect(canTransitionQuestStatus("abandoned", "failed")).toBe(false);
    });
  });

  describe("self-transitions", () => {
    test("same status → same status: never allowed", () => {
      expect(canTransitionQuestStatus("available", "available")).toBe(false);
      expect(canTransitionQuestStatus("active", "active")).toBe(false);
      expect(canTransitionQuestStatus("completed", "completed")).toBe(false);
      expect(canTransitionQuestStatus("failed", "failed")).toBe(false);
      expect(canTransitionQuestStatus("abandoned", "abandoned")).toBe(false);
    });
  });
});

describe("assertQuestTransition", () => {
  test("valid transition: does not throw", () => {
    expect(() => assertQuestTransition("available", "active")).not.toThrow();
    expect(() => assertQuestTransition("active", "completed")).not.toThrow();
    expect(() => assertQuestTransition("failed", "available")).not.toThrow();
    expect(() => assertQuestTransition("abandoned", "available")).not.toThrow();
  });

  test("invalid transition: throws with descriptive message", () => {
    expect(() => assertQuestTransition("completed", "active")).toThrow(
      "Invalid quest status transition: completed -> active",
    );
    expect(() => assertQuestTransition("active", "available")).toThrow(
      "Invalid quest status transition: active -> available",
    );
    expect(() => assertQuestTransition("completed", "abandoned")).toThrow(
      "Invalid quest status transition: completed -> abandoned",
    );
  });
});
