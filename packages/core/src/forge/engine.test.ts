import { describe, expect, test } from "bun:test";

import {
  buildForgeActionPlan,
  buildForgeDedupeKey,
  createForgeRule,
  cronMatchesAt,
  shouldTriggerForgeRule,
  toggleForgeRule,
} from "./engine";
import { evaluateCompanionForgePermission } from "./policy";
import type { ForgeEvent } from "./engine";
import type { ForgeRule } from "../schema";

const USER_ID = "user-test-id";

function makeRule(overrides: Partial<ForgeRule> = {}): ForgeRule {
  return createForgeRule({
    userId: USER_ID,
    name: "Test Rule",
    triggerType: "event",
    triggerConfig: {},
    actionType: "queue-quest",
    actionConfig: {},
    enabled: true,
    ...overrides,
  });
}

function makeEvent(overrides: Partial<ForgeEvent> = {}): ForgeEvent {
  return {
    type: "event",
    payload: {},
    at: Date.now(),
    ...overrides,
  };
}

describe("createForgeRule", () => {
  test("creates rule with generated id and timestamps", () => {
    const rule = makeRule();
    expect(typeof rule.id).toBe("string");
    expect(rule.id.length).toBeGreaterThan(0);
    expect(typeof rule.createdAt).toBe("number");
    expect(typeof rule.updatedAt).toBe("number");
    expect(rule.enabled).toBe(true);
  });

  test("defaults enabled to true", () => {
    const rule = createForgeRule({
      userId: USER_ID,
      name: "My Rule",
      triggerType: "manual",
      triggerConfig: {},
      actionType: "send-notification",
      actionConfig: {},
      enabled: true,
    });
    expect(rule.enabled).toBe(true);
  });

  test("respects enabled: false", () => {
    const rule = makeRule({ enabled: false });
    expect(rule.enabled).toBe(false);
  });
});

describe("toggleForgeRule", () => {
  test("flips enabled from true to false", () => {
    const rule = makeRule({ enabled: true });
    const toggled = toggleForgeRule(rule);
    expect(toggled.enabled).toBe(false);
  });

  test("flips enabled from false to true", () => {
    const rule = makeRule({ enabled: false });
    const toggled = toggleForgeRule(rule);
    expect(toggled.enabled).toBe(true);
  });

  test("explicit true overrides current value", () => {
    const rule = makeRule({ enabled: false });
    const toggled = toggleForgeRule(rule, true);
    expect(toggled.enabled).toBe(true);
  });

  test("explicit false overrides current value", () => {
    const rule = makeRule({ enabled: true });
    const toggled = toggleForgeRule(rule, false);
    expect(toggled.enabled).toBe(false);
  });

  test("updatedAt changes after toggle", () => {
    const rule = makeRule();
    const before = rule.updatedAt;
    const toggled = toggleForgeRule(rule);
    expect(toggled.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("shouldTriggerForgeRule", () => {
  test("disabled rule never triggers", () => {
    const rule = makeRule({ enabled: false });
    const event = makeEvent({ type: "event" });
    expect(shouldTriggerForgeRule(rule, event)).toBe(false);
  });

  test("trigger type mismatch returns false", () => {
    const rule = makeRule({ triggerType: "event" });
    const event = makeEvent({ type: "signal" });
    expect(shouldTriggerForgeRule(rule, event)).toBe(false);
  });

  test("event trigger with empty config matches any payload", () => {
    const rule = makeRule({ triggerType: "event", triggerConfig: {} });
    const event = makeEvent({ type: "event", payload: { anything: "here" } });
    expect(shouldTriggerForgeRule(rule, event)).toBe(true);
  });

  test("event trigger with payload filter matches exact value", () => {
    const rule = makeRule({ triggerType: "event", triggerConfig: { action: "quest_complete" } });
    const matchingEvent = makeEvent({ type: "event", payload: { action: "quest_complete" } });
    const nonMatchingEvent = makeEvent({ type: "event", payload: { action: "quest_abandon" } });
    expect(shouldTriggerForgeRule(rule, matchingEvent)).toBe(true);
    expect(shouldTriggerForgeRule(rule, nonMatchingEvent)).toBe(false);
  });

  test("event trigger with missing payload key returns false", () => {
    const rule = makeRule({ triggerType: "event", triggerConfig: { userId: "abc" } });
    const event = makeEvent({ type: "event", payload: {} });
    expect(shouldTriggerForgeRule(rule, event)).toBe(false);
  });

  test("cron trigger with no cron field returns false", () => {
    const rule = makeRule({ triggerType: "cron", triggerConfig: {} });
    const event = makeEvent({ type: "cron" });
    expect(shouldTriggerForgeRule(rule, event)).toBe(false);
  });

  test("cron trigger fires when cron matches event time", () => {
    // 2026-02-20 12:00:00 UTC — a Friday
    const at = new Date("2026-02-20T12:00:00Z").getTime();
    const rule = makeRule({ triggerType: "cron", triggerConfig: { cron: "0 12 * * *" } });
    const event: ForgeEvent = { type: "cron", payload: {}, at };
    expect(shouldTriggerForgeRule(rule, event)).toBe(true);
  });

  test("cron trigger does not fire when time does not match", () => {
    const at = new Date("2026-02-20T12:01:00Z").getTime();
    const rule = makeRule({ triggerType: "cron", triggerConfig: { cron: "0 12 * * *" } });
    const event: ForgeEvent = { type: "cron", payload: {}, at };
    expect(shouldTriggerForgeRule(rule, event)).toBe(false);
  });
});

describe("buildForgeActionPlan", () => {
  test("returns null when rule should not trigger", () => {
    const rule = makeRule({ enabled: false });
    const event = makeEvent();
    expect(buildForgeActionPlan(rule, event)).toBeNull();
  });

  test("returns plan when rule triggers", () => {
    const rule = makeRule({ triggerType: "event", triggerConfig: {} });
    const event = makeEvent({ type: "event" });
    const plan = buildForgeActionPlan(rule, event);
    expect(plan).not.toBeNull();
    expect(plan!.ruleId).toBe(rule.id);
    expect(plan!.actionType).toBe("queue-quest");
    expect(plan!.eventAt).toBe(event.at);
  });

  test("uses provided dedupeKey from event", () => {
    const rule = makeRule({ triggerType: "event", triggerConfig: {} });
    const event = makeEvent({ type: "event", dedupeKey: "custom-key-123" });
    const plan = buildForgeActionPlan(rule, event);
    expect(plan!.dedupeKey).toBe("custom-key-123");
  });

  test("merges eventPayload into actionConfig", () => {
    const rule = makeRule({
      triggerType: "event",
      triggerConfig: {},
      actionConfig: { message: "hello" },
    });
    const event = makeEvent({ type: "event", payload: { userId: "u1" } });
    const plan = buildForgeActionPlan(rule, event);
    expect((plan!.actionConfig as Record<string, unknown>).message).toBe("hello");
    expect((plan!.actionConfig as Record<string, unknown>).eventPayload).toEqual({ userId: "u1" });
  });
});

describe("buildForgeDedupeKey", () => {
  test("uses event.dedupeKey when provided", () => {
    const rule = makeRule();
    const event = makeEvent({ dedupeKey: "explicit-key" });
    expect(buildForgeDedupeKey(rule, event)).toBe("explicit-key");
  });

  test("cron dedupe key uses minute bucket", () => {
    const at = new Date("2026-02-20T12:00:00Z").getTime();
    const rule = makeRule({ triggerType: "cron" });
    const event: ForgeEvent = { type: "cron", payload: {}, at };
    const key = buildForgeDedupeKey(rule, event);
    expect(key).toMatch(/^cron:\d+$/);
    expect(key).toBe(`cron:${Math.floor(at / 60_000)}`);
  });

  test("event with eventId uses type:eventId", () => {
    const rule = makeRule({ triggerType: "event" });
    const event = makeEvent({ type: "event", payload: { eventId: "evt-abc" } });
    const key = buildForgeDedupeKey(rule, event);
    expect(key).toBe("event:evt-abc");
  });

  test("event with id field (no eventId) uses type:id", () => {
    const rule = makeRule({ triggerType: "event" });
    const event = makeEvent({ type: "event", payload: { id: "obj-xyz" } });
    const key = buildForgeDedupeKey(rule, event);
    expect(key).toBe("event:obj-xyz");
  });

  test("event with no id falls back to payload signature + bucket", () => {
    const at = 1_000_000 * 60_000; // exact minute boundary
    const rule = makeRule({ triggerType: "event" });
    const event: ForgeEvent = { type: "event", payload: { foo: "bar" }, at };
    const key = buildForgeDedupeKey(rule, event);
    expect(key).toBe(`event:${Math.floor(at / 60_000)}:${JSON.stringify({ foo: "bar" })}`);
  });
});

describe("cronMatchesAt", () => {
  const t = (iso: string) => new Date(iso).getTime();

  test("invalid expression (wrong field count) returns false", () => {
    expect(cronMatchesAt("* * *", t("2026-02-20T12:00:00Z"))).toBe(false);
    expect(cronMatchesAt("* * * * * *", t("2026-02-20T12:00:00Z"))).toBe(false);
  });

  test("wildcard * * * * * matches any time", () => {
    expect(cronMatchesAt("* * * * *", t("2026-02-20T12:34:00Z"))).toBe(true);
  });

  test("exact time match: 30 9 * * * matches 09:30", () => {
    expect(cronMatchesAt("30 9 * * *", t("2026-02-20T09:30:00Z"))).toBe(true);
  });

  test("exact time does not match 09:31", () => {
    expect(cronMatchesAt("30 9 * * *", t("2026-02-20T09:31:00Z"))).toBe(false);
  });

  test("range: 0-30 * * * * matches minute 15", () => {
    expect(cronMatchesAt("0-30 * * * *", t("2026-02-20T10:15:00Z"))).toBe(true);
  });

  test("range: 0-30 * * * * does not match minute 31", () => {
    expect(cronMatchesAt("0-30 * * * *", t("2026-02-20T10:31:00Z"))).toBe(false);
  });

  test("step: */15 * * * * matches minutes 0, 15, 30, 45", () => {
    expect(cronMatchesAt("*/15 * * * *", t("2026-02-20T10:00:00Z"))).toBe(true);
    expect(cronMatchesAt("*/15 * * * *", t("2026-02-20T10:15:00Z"))).toBe(true);
    expect(cronMatchesAt("*/15 * * * *", t("2026-02-20T10:30:00Z"))).toBe(true);
    expect(cronMatchesAt("*/15 * * * *", t("2026-02-20T10:45:00Z"))).toBe(true);
  });

  test("step: */15 * * * * does not match minute 7", () => {
    expect(cronMatchesAt("*/15 * * * *", t("2026-02-20T10:07:00Z"))).toBe(false);
  });

  test("weekday: 0 9 * * 1 matches Monday", () => {
    // 2026-02-23 is a Monday
    expect(cronMatchesAt("0 9 * * 1", t("2026-02-23T09:00:00Z"))).toBe(true);
  });

  test("weekday: 0 9 * * 1 does not match Friday", () => {
    // 2026-02-20 is a Friday (day 5)
    expect(cronMatchesAt("0 9 * * 1", t("2026-02-20T09:00:00Z"))).toBe(false);
  });

  test("weekday 7 is treated as Sunday (0)", () => {
    // 2026-02-22 is a Sunday
    expect(cronMatchesAt("0 0 * * 7", t("2026-02-22T00:00:00Z"))).toBe(true);
  });

  test("comma list: 0 9,17 * * * matches 09:00 and 17:00", () => {
    expect(cronMatchesAt("0 9,17 * * *", t("2026-02-20T09:00:00Z"))).toBe(true);
    expect(cronMatchesAt("0 9,17 * * *", t("2026-02-20T17:00:00Z"))).toBe(true);
    expect(cronMatchesAt("0 9,17 * * *", t("2026-02-20T12:00:00Z"))).toBe(false);
  });

  test("month field: 0 0 1 3 * matches March 1st", () => {
    expect(cronMatchesAt("0 0 1 3 *", t("2026-03-01T00:00:00Z"))).toBe(true);
    expect(cronMatchesAt("0 0 1 3 *", t("2026-02-01T00:00:00Z"))).toBe(false);
  });
});

describe("evaluateCompanionForgePermission (policy)", () => {
  test("suggest intent is always allowed regardless of trust or risk", () => {
    const result = evaluateCompanionForgePermission(0, "run-script", "suggest");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  test("draft with trust < 2 is denied", () => {
    const result = evaluateCompanionForgePermission(1, "queue-quest", "draft");
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  test("draft high-risk action is denied even at trust 3", () => {
    const result = evaluateCompanionForgePermission(3, "run-script", "draft");
    expect(result.allowed).toBe(false);
  });

  test("draft low-risk at trust 2: allowed but requires approval", () => {
    const result = evaluateCompanionForgePermission(2, "queue-quest", "draft");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  test("enable high-risk action is always denied", () => {
    const result = evaluateCompanionForgePermission(4, "run-script", "enable");
    expect(result.allowed).toBe(false);
  });

  test("enable low-risk at trust 3 (agent): allowed, no approval", () => {
    const result = evaluateCompanionForgePermission(3, "queue-quest", "enable");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  test("enable medium-risk at trust 3: denied", () => {
    const result = evaluateCompanionForgePermission(3, "update-skill", "enable");
    expect(result.allowed).toBe(false);
  });

  test("enable medium-risk at trust 4 (sovereign): allowed, no approval", () => {
    const result = evaluateCompanionForgePermission(4, "update-skill", "enable");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  test("enable low-risk at trust 1: denied", () => {
    const result = evaluateCompanionForgePermission(1, "send-notification", "enable");
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });
});
