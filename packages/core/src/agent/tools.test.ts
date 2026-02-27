import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

import { createGrindTools } from "./tools";
import {
  createTestToolContext,
  createTestUser,
  createTestVault,
  type TestVault,
} from "../test-helpers";
import { upsertCompanion } from "../vault/repositories/companion";
import { createQuest } from "../vault/repositories/quests";
import { addXpToUser } from "../vault/repositories/users";

let vault: TestVault;
let userId: string;
let tools: ReturnType<typeof createGrindTools>;
let timerDir: string;

type ToolResult = Record<string, unknown>;

async function call(tool: { execute?: Function }, args: ToolResult = {}): Promise<ToolResult> {
  if (!tool.execute) throw new Error("Tool has no execute");
  const result = await (tool.execute as Function)(args, { toolCallId: "test", messages: [] });
  return result as ToolResult;
}

beforeEach(async () => {
  vault = await createTestVault();
  const user = await createTestUser(vault.db);
  userId = user.id;
  const ctx = createTestToolContext(vault.db, userId);
  timerDir = ctx.timerDir;
  tools = createGrindTools(ctx);
});

afterEach(() => {
  vault.close();
});

function makeQuest(title = "Test Quest", overrides: ToolResult = {}) {
  return createQuest(vault.db, {
    userId,
    title,
    type: "bounty" as const,
    difficulty: "easy" as const,
    skillTags: [] as string[],
    baseXp: 10,
    objectives: [] as never[],
    metadata: {},
    ...(overrides as object),
  });
}

describe("get_status", () => {
  test("returns level 1, 0 XP for new user with no quests", async () => {
    const result = await call(tools.get_status);
    expect(result.level).toBe(1);
    expect(result.totalXp).toBe(0);
    expect(result.activeQuests).toBe(0);
    expect(result.completedToday).toBe(0);
    expect(result.timerRunning).toBe(false);
    expect(result.timerQuest).toBeNull();
  });

  test("reflects active quests count", async () => {
    await makeQuest("Quest A");
    await makeQuest("Quest B");
    const result = await call(tools.get_status);
    expect(result.activeQuests).toBe(2);
    expect(result.maxActiveQuests).toBe(5);
  });

  test("shows running timer when timer file exists", async () => {
    const quest = await makeQuest("Workout");
    const timerPath = join(timerDir, "timer.json");
    writeFileSync(
      timerPath,
      JSON.stringify({ questId: quest.id, questTitle: "Workout", userId, startedAt: Date.now() }),
    );
    const freshTools = createGrindTools(createTestToolContext(vault.db, userId, { timerDir }));

    const result = await call(freshTools.get_status);
    expect(result.timerRunning).toBe(true);
    expect(result.timerQuest).toBe("Workout");
  });

  test("xpToNextLevel decreases as XP is added", async () => {
    const r1 = await call(tools.get_status);
    await addXpToUser(vault.db, userId, 100);
    const freshTools = createGrindTools(createTestToolContext(vault.db, userId, { timerDir }));
    const r2 = await call(freshTools.get_status);
    expect(Number(r2.xpToNextLevel)).toBeLessThan(Number(r1.xpToNextLevel));
  });
});

describe("list_quests", () => {
  test("empty when no quests", async () => {
    const result = await call(tools.list_quests);
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown as unknown[]).length).toBe(0);
  });

  test("returns all quests without filter", async () => {
    await makeQuest("Quest A");
    await makeQuest("Quest B");
    const result = await call(tools.list_quests);
    expect((result as unknown as unknown[]).length).toBe(2);
  });

  test("filters by active status", async () => {
    await makeQuest("Active Quest");
    const result = await call(tools.list_quests, { status: "active" });
    const list = result as unknown as Array<Record<string, unknown>>;
    expect(list.every((q) => q["status"] === "active")).toBe(true);
  });
});

describe("create_quest", () => {
  test("creates a quest and returns summary", async () => {
    const result = await call(tools.create_quest, {
      title: "Morning Workout",
      type: "daily",
      difficulty: "medium",
      skillTags: ["fitness"],
      baseXp: 20,
    });
    expect(result.title).toBe("Morning Workout");
    expect(result.type).toBe("daily");
    expect(result.status).toBe("active");
  });

  test("rejects when at max 5 active quests", async () => {
    for (let i = 0; i < 5; i++) {
      await makeQuest(`Quest ${i}`);
    }
    const result = await call(tools.create_quest, {
      title: "One Too Many",
      type: "bounty",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
    });
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("Max 5");
  });

  test("created quest is visible in list_quests", async () => {
    await call(tools.create_quest, {
      title: "New Quest",
      type: "bounty",
      difficulty: "easy",
      skillTags: [],
      baseXp: 10,
    });
    const list = (await call(tools.list_quests)) as unknown as Array<Record<string, unknown>>;
    expect(list.some((q) => q["title"] === "New Quest")).toBe(true);
  });
});

describe("complete_quest", () => {
  test("completes quest by title and returns XP", async () => {
    await makeQuest("Daily Run");
    const result = await call(tools.complete_quest, {
      questSearch: "Daily Run",
      proofType: "self-report",
    });
    expect(result.error).toBeUndefined();
    expect(result.quest).toBe("Daily Run");
    expect(Number(result.xpEarned)).toBeGreaterThan(0);
  });

  test("duration proof gives more XP than self-report", async () => {
    const q1 = await makeQuest("Self Quest");
    const q2 = await makeQuest("Timer Quest");

    const selfResult = await call(tools.complete_quest, {
      questSearch: q1.id.slice(0, 8),
      proofType: "self-report",
    });
    const timerResult = await call(tools.complete_quest, {
      questSearch: q2.id.slice(0, 8),
      proofType: "duration",
      durationMinutes: 30,
    });
    expect(Number(timerResult.xpEarned)).toBeGreaterThan(Number(selfResult.xpEarned));
  });

  test("returns error for nonexistent quest", async () => {
    const result = await call(tools.complete_quest, {
      questSearch: "nope-not-a-quest",
      proofType: "self-report",
    });
    expect(result.error).toBeDefined();
  });

  test("returns error if quest already completed", async () => {
    await makeQuest("Complete Me");
    await call(tools.complete_quest, { questSearch: "Complete Me", proofType: "self-report" });
    const result = await call(tools.complete_quest, {
      questSearch: "Complete Me",
      proofType: "self-report",
    });
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("already completed");
  });

  test("leveledUp is true when XP crosses level threshold", async () => {
    await addXpToUser(vault.db, userId, 290);
    await makeQuest("Level Up Quest");
    const result = await call(tools.complete_quest, {
      questSearch: "Level Up Quest",
      proofType: "self-report",
    });
    expect(result.leveledUp).toBe(true);
  });

  test("skillGains distributed for quests with skill tags", async () => {
    await makeQuest("Skill Quest", { skillTags: ["fitness", "discipline"], baseXp: 20 });
    const result = await call(tools.complete_quest, {
      questSearch: "Skill Quest",
      proofType: "self-report",
    });
    const gains = result.skillGains as Array<Record<string, unknown>>;
    expect(gains).toHaveLength(2);
    expect(gains.every((g) => Number(g["xpGained"]) > 0)).toBe(true);
  });
});

describe("abandon_quest", () => {
  test("abandons an active quest", async () => {
    await makeQuest("Give Up Quest");
    const result = await call(tools.abandon_quest, { questSearch: "Give Up Quest" });
    expect(result.error).toBeUndefined();
    expect(result.quest).toBe("Give Up Quest");
    expect(result.streakLost).toBe(0);
  });

  test("shows streak lost when abandoning quest with streak", async () => {
    await makeQuest("Streak Quest", { streakCount: 7 });
    const result = await call(tools.abandon_quest, { questSearch: "Streak Quest" });
    expect(result.streakLost).toBe(7);
  });

  test("returns error for completed quest", async () => {
    await makeQuest("Done Quest");
    await call(tools.complete_quest, { questSearch: "Done Quest", proofType: "self-report" });
    const result = await call(tools.abandon_quest, { questSearch: "Done Quest" });
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("not active");
  });

  test("returns error for unknown quest", async () => {
    const result = await call(tools.abandon_quest, { questSearch: "no-such-quest" });
    expect(result.error).toBeDefined();
  });
});

describe("start_timer + stop_timer + get_timer", () => {
  test("starts timer for active quest", async () => {
    await makeQuest("Timed Quest");
    const result = await call(tools.start_timer, { questSearch: "Timed Quest" });
    expect(result.error).toBeUndefined();
    expect(result.started).toBe(true);
    expect(result.quest).toBe("Timed Quest");
  });

  test("get_timer shows running state after start", async () => {
    await makeQuest("Timer Quest");
    await call(tools.start_timer, { questSearch: "Timer Quest" });
    const status = await call(tools.get_timer);
    expect(status.running).toBe(true);
    expect(status.quest).toBe("Timer Quest");
  });

  test("get_timer returns not running when no timer", async () => {
    const status = await call(tools.get_timer);
    expect(status.running).toBe(false);
  });

  test("stop without complete: returns elapsed, completed=false", async () => {
    await makeQuest("Timed Quest");
    await call(tools.start_timer, { questSearch: "Timed Quest" });
    const result = await call(tools.stop_timer, { complete: false });
    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(false);
    expect(result.quest).toBe("Timed Quest");
    expect(result.durationMinutes).toBeNumber();
  });

  test("stop with complete=true: awards XP", async () => {
    const quest = await makeQuest("Timed Quest");
    const timerPath = join(timerDir, "timer.json");
    writeFileSync(
      timerPath,
      JSON.stringify({
        questId: quest.id,
        questTitle: "Timed Quest",
        userId,
        startedAt: Date.now() - 5 * 60 * 1000,
      }),
    );
    const freshTools = createGrindTools(createTestToolContext(vault.db, userId, { timerDir }));
    const result = await call(freshTools.stop_timer, { complete: true });
    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(true);
    expect(Number(result.xpEarned)).toBeGreaterThan(0);
  });

  test("start when already running: returns error", async () => {
    await makeQuest("Quest A");
    await makeQuest("Quest B");
    await call(tools.start_timer, { questSearch: "Quest A" });
    const result = await call(tools.start_timer, { questSearch: "Quest B" });
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("already running");
  });

  test("stop when no timer running: returns error", async () => {
    const result = await call(tools.stop_timer, { complete: false });
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("No timer running");
  });

  test("start timer for completed quest: returns error", async () => {
    const quest = await makeQuest("Done Quest");
    await call(tools.complete_quest, {
      questSearch: quest.id.slice(0, 8),
      proofType: "self-report",
    });
    const result = await call(tools.start_timer, { questSearch: quest.id.slice(0, 8) });
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("not active");
  });

  test("after stopping timer, get_timer shows not running", async () => {
    await makeQuest("Timer Quest");
    await call(tools.start_timer, { questSearch: "Timer Quest" });
    await call(tools.stop_timer, { complete: false });
    const status = await call(tools.get_timer);
    expect(status.running).toBe(false);
  });
});

describe("analyze_patterns", () => {
  test("empty vault: all zeros", async () => {
    const result = await call(tools.analyze_patterns);
    expect(result.totalCompleted).toBe(0);
    expect(result.totalAbandoned).toBe(0);
    expect(result.completionRate).toBe("0%");
  });

  test("calculates completion rate correctly", async () => {
    const q1 = await makeQuest("Done");
    const q2 = await makeQuest("Abandoned");
    await call(tools.complete_quest, { questSearch: q1.id.slice(0, 8), proofType: "self-report" });
    await call(tools.abandon_quest, { questSearch: q2.id.slice(0, 8) });

    const result = await call(tools.analyze_patterns);
    expect(result.completionRate).toBe("50%");
    expect(result.totalCompleted).toBe(1);
    expect(result.totalAbandoned).toBe(1);
  });

  test("counts quests completed this week", async () => {
    const quest = await makeQuest("Weekly Quest");
    await call(tools.complete_quest, {
      questSearch: quest.id.slice(0, 8),
      proofType: "self-report",
    });
    const result = await call(tools.analyze_patterns);
    expect(result.completedThisWeek).toBe(1);
  });

  test("aggregates topSkills from completed quests", async () => {
    await makeQuest("Skill Quest", { skillTags: ["fitness", "discipline"] });
    const list = (await call(tools.list_quests)) as unknown as Array<Record<string, unknown>>;
    const q = list[0];
    if (!q) throw new Error("no quest");
    await call(tools.complete_quest, {
      questSearch: q["title"] as string,
      proofType: "self-report",
    });
    const result = await call(tools.analyze_patterns);
    expect((result.topSkills as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("suggest_quest", () => {
  test("returns suggestion for level 1 user (easy difficulty)", async () => {
    const result = await call(tools.suggest_quest);
    expect(result.currentLevel).toBe(1);
    expect(result.suggestedDifficulty).toBe("easy");
    expect(result.slotsAvailable).toBe(5);
  });

  test("suggests medium difficulty at higher level", async () => {
    await addXpToUser(vault.db, userId, 1000);
    const freshTools = createGrindTools(createTestToolContext(vault.db, userId, { timerDir }));
    const result = await call(freshTools.suggest_quest);
    expect(result.suggestedDifficulty).toBe("medium");
  });

  test("reflects occupied quest slots", async () => {
    await makeQuest("Q1");
    await makeQuest("Q2");
    const result = await call(tools.suggest_quest);
    expect(result.slotsAvailable).toBe(3);
    expect(result.activeCount).toBe(2);
  });

  test("goal is echoed back when provided", async () => {
    const result = await call(tools.suggest_quest, { goal: "get fit" });
    expect(result.goal).toBe("get fit");
  });
});

describe("forge tools", () => {
  test("creates, lists, updates, and deletes forge rules", async () => {
    const quest = await makeQuest("Forge Quest");

    const created = await call(tools.create_forge_rule, {
      name: "Queue Forge Quest",
      triggerType: "manual",
      triggerConfig: {},
      actionType: "queue-quest",
      actionConfig: { questId: quest.id },
      enabled: true,
    });

    expect(created.ok).toBe(true);
    const createdRule = created.rule as Record<string, unknown>;
    expect(createdRule["actionType"]).toBe("queue-quest");
    const ruleId = createdRule["id"];
    expect(typeof ruleId).toBe("string");

    const listed = await call(tools.list_forge_rules, { includeRecentRuns: false });
    expect(Number(listed.count)).toBeGreaterThan(0);
    const rules = listed.rules as Array<Record<string, unknown>>;
    expect(rules.some((rule) => rule["id"] === ruleId)).toBe(true);

    const updated = await call(tools.update_forge_rule, {
      ruleSearch: String(ruleId).slice(0, 8),
      enabled: false,
    });
    expect(updated.ok).toBe(true);
    const updatedRule = updated.rule as Record<string, unknown>;
    expect(updatedRule["enabled"]).toBe(false);

    const deleted = await call(tools.delete_forge_rule, {
      ruleSearch: String(ruleId).slice(0, 8),
    });
    expect(deleted.ok).toBe(true);

    const listedAfterDelete = await call(tools.list_forge_rules, { includeRecentRuns: false });
    const rulesAfterDelete = listedAfterDelete.rules as Array<Record<string, unknown>>;
    expect(rulesAfterDelete.some((rule) => rule["id"] === ruleId)).toBe(false);
  });

  test("runs forge rule immediately and exposes run history", async () => {
    const created = await call(tools.create_forge_rule, {
      name: "Console Ping Rule",
      triggerType: "manual",
      triggerConfig: {},
      actionType: "send-notification",
      actionConfig: {
        channel: "console",
        message: "Forge run now test",
      },
      enabled: true,
    });

    expect(created.ok).toBe(true);
    const createdRule = created.rule as Record<string, unknown>;
    const ruleId = createdRule["id"];
    expect(typeof ruleId).toBe("string");

    const run = await call(tools.run_forge_rule, {
      ruleSearch: String(ruleId).slice(0, 8),
    });
    expect(run.ok).toBe(true);
    const runData = run.run as Record<string, unknown>;
    expect(runData["status"]).toBe("success");

    const runs = await call(tools.list_forge_runs, {
      ruleSearch: String(ruleId).slice(0, 8),
      limit: 5,
    });
    expect(Number(runs.count)).toBeGreaterThan(0);
    const runItems = runs.runs as Array<Record<string, unknown>>;
    expect(runItems.some((entry) => entry["status"] === "success")).toBe(true);
  });

  test("validates forge rule configs with actionable errors", async () => {
    const badCron = await call(tools.create_forge_rule, {
      name: "Bad Cron Rule",
      triggerType: "cron",
      triggerConfig: { cron: "* * *" },
      actionType: "send-notification",
      actionConfig: { channel: "console" },
      enabled: true,
    });
    expect(badCron.ok).toBe(false);
    expect(String(badCron.error)).toContain("Invalid cron expression");

    const missingToken = await call(tools.create_forge_rule, {
      name: "Missing Telegram Token Rule",
      triggerType: "manual",
      triggerConfig: {},
      actionType: "send-notification",
      actionConfig: {
        channel: "telegram",
        chatId: "123456789",
      },
      enabled: true,
    });
    expect(missingToken.ok).toBe(false);
    expect(String(missingToken.error)).toContain("telegram notifications require a bot token");
  });
});

describe("forge tools — webhook trigger", () => {
  test("create_forge_rule with webhook trigger persists triggerType correctly", async () => {
    const result = await call(tools.create_forge_rule, {
      name: "On-Demand Webhook Rule",
      triggerType: "webhook",
      triggerConfig: {},
      actionType: "send-notification",
      actionConfig: { channel: "console", message: "triggered" },
      enabled: true,
    });
    expect(result.ok).toBe(true);
    const rule = result.rule as Record<string, unknown>;
    expect(rule["triggerType"]).toBe("webhook");
    expect(rule["name"]).toBe("On-Demand Webhook Rule");
  });

  test("update_forge_rule converts cron rule to webhook trigger", async () => {
    const created = await call(tools.create_forge_rule, {
      name: "Daily Alert",
      triggerType: "cron",
      triggerConfig: { cron: "0 9 * * 1-5", timezone: "UTC" },
      actionType: "send-notification",
      actionConfig: { channel: "console", message: "morning" },
      enabled: true,
    });
    expect(created.ok).toBe(true);
    const ruleId = (created.rule as Record<string, unknown>)["id"] as string;

    const updated = await call(tools.update_forge_rule, {
      ruleSearch: ruleId.slice(0, 8),
      triggerType: "webhook",
      triggerConfig: {},
    });
    expect(updated.ok).toBe(true);
    const rule = updated.rule as Record<string, unknown>;
    expect(rule["triggerType"]).toBe("webhook");
  });
});

describe("forge tools — run-script validation", () => {
  test("create_forge_rule run-script without script field returns actionable error", async () => {
    const result = await call(tools.create_forge_rule, {
      name: "Missing Script Rule",
      triggerType: "manual",
      triggerConfig: {},
      actionType: "run-script",
      actionConfig: {},
      enabled: true,
    });
    expect(result.ok).toBe(false);
    expect(String(result.error).toLowerCase()).toContain("script");
  });

  test("create_forge_rule run-script with empty string script returns error", async () => {
    const result = await call(tools.create_forge_rule, {
      name: "Empty Script Rule",
      triggerType: "manual",
      triggerConfig: {},
      actionType: "run-script",
      actionConfig: { script: "   " },
      enabled: true,
    });
    expect(result.ok).toBe(false);
  });

  test("create_forge_rule run-script with valid script and webhook trigger succeeds", async () => {
    const result = await call(tools.create_forge_rule, {
      name: "Recreate Church Reminders",
      triggerType: "webhook",
      triggerConfig: {},
      actionType: "run-script",
      actionConfig: { script: "#!/bin/bash\necho 'recreating reminders'" },
      enabled: true,
    });
    expect(result.ok).toBe(true);
    const rule = result.rule as Record<string, unknown>;
    expect(rule["actionType"]).toBe("run-script");
    expect(rule["triggerType"]).toBe("webhook");
  });

  test("update_forge_rule changing actionType to run-script requires actionConfig", async () => {
    const created = await call(tools.create_forge_rule, {
      name: "Notify Rule",
      triggerType: "manual",
      triggerConfig: {},
      actionType: "send-notification",
      actionConfig: { channel: "console", message: "ping" },
      enabled: true,
    });
    const ruleId = (created.rule as Record<string, unknown>)["id"] as string;

    const result = await call(tools.update_forge_rule, {
      ruleSearch: ruleId.slice(0, 8),
      actionType: "run-script",
    });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("actionConfig");
  });
});

describe("forge tools — batch_delete_forge_rules", () => {
  async function makeRule(name: string) {
    const result = await call(tools.create_forge_rule, {
      name,
      triggerType: "manual",
      triggerConfig: {},
      actionType: "send-notification",
      actionConfig: { channel: "console", message: "ping" },
      enabled: true,
    });
    return result.rule as Record<string, unknown>;
  }

  test("deletes all matching rules and DB is empty after", async () => {
    const r1 = await makeRule("Church Reminder A");
    const r2 = await makeRule("Church Reminder B");
    const r3 = await makeRule("Church Reminder C");

    const result = await call(tools.batch_delete_forge_rules, {
      ruleSearches: [r1["name"], r2["name"], r3["name"]],
    });
    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(3);

    const listed = await call(tools.list_forge_rules, { includeRecentRuns: false });
    expect(listed.count).toBe(0);
  });

  test("partial match: deletes known rules, reports failures for unknown", async () => {
    const r1 = await makeRule("Keep Rule A");
    const r2 = await makeRule("Keep Rule B");

    const result = await call(tools.batch_delete_forge_rules, {
      ruleSearches: [r1["name"], r2["name"], "no-such-rule-xyz"],
    });
    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(3);

    const listed = await call(tools.list_forge_rules, { includeRecentRuns: false });
    expect(listed.count).toBe(0);
  });

  test("permission denied: returns error and DB is unchanged", async () => {
    const r1 = await makeRule("Protected Rule A");
    const r2 = await makeRule("Protected Rule B");

    const denyCtx = {
      ...createTestToolContext(vault.db, userId),
      requestPermission: async () => "deny" as const,
    };
    const denyTools = createGrindTools(denyCtx);

    const result = await call(denyTools.batch_delete_forge_rules, {
      ruleSearches: [r1["name"], r2["name"]],
    });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("cancelled");

    const listed = await call(tools.list_forge_rules, { includeRecentRuns: false });
    expect(listed.count).toBe(2);
  });

  test("single-item array (boundary): deletes exactly one rule", async () => {
    await makeRule("Solo Rule");
    await makeRule("Other Rule");

    const result = await call(tools.batch_delete_forge_rules, {
      ruleSearches: ["Solo Rule"],
    });
    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(1);
    expect(result.total).toBe(1);

    const listed = await call(tools.list_forge_rules, { includeRecentRuns: false });
    expect(listed.count).toBe(1);
    const rules = listed.rules as Array<Record<string, unknown>>;
    expect(rules[0]?.["name"]).toBe("Other Rule");
  });
});

describe("companion memory tools", () => {
  test("store_insight creates and dedupes identical insights", async () => {
    const first = await call(tools.store_insight, {
      category: "pattern",
      content: "User tends to skip Thursday evening workouts",
      confidence: 0.6,
      source: "ai-observed",
      dedupe: true,
    });

    expect(first.created).toBe(true);
    expect(first.deduped).toBe(false);

    const second = await call(tools.store_insight, {
      category: "pattern",
      content: "User tends to skip Thursday evening workouts",
      confidence: 0.9,
      source: "ai-observed",
      dedupe: true,
    });

    expect(second.created).toBe(false);
    expect(second.deduped).toBe(true);
    expect(Number(second.confidence)).toBe(0.9);

    const listed = (await call(tools.list_insights, { limit: 10 })) as unknown as Array<
      Record<string, unknown>
    >;
    expect(listed).toHaveLength(1);
  });

  test("store_insight dedupes same insight with different casing", async () => {
    const first = await call(tools.store_insight, {
      category: "preference",
      content: "User prefers short morning sessions",
      confidence: 0.5,
      source: "ai-observed",
      dedupe: true,
    });

    const second = await call(tools.store_insight, {
      category: "preference",
      content: "user prefers short morning sessions",
      confidence: 0.9,
      source: "user-stated",
      dedupe: true,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.source).toBe("user-stated");
    expect(Number(second.confidence)).toBe(0.9);

    const listed = (await call(tools.list_insights, { limit: 10 })) as unknown as Array<
      Record<string, unknown>
    >;
    expect(listed).toHaveLength(1);
  });

  test("update_insight updates persisted insight fields", async () => {
    const created = await call(tools.store_insight, {
      category: "goal",
      content: "GMAT target 700 by July",
      confidence: 0.8,
      source: "user-stated",
      dedupe: true,
    });

    const updated = await call(tools.update_insight, {
      insightId: created.id,
      content: "GMAT target 700+ by July",
      confidence: 1,
    });

    expect(updated.content).toBe("GMAT target 700+ by July");
    expect(updated.confidence).toBe(1);
  });

  test("update_user_context requires companion settings", async () => {
    const result = await call(tools.update_user_context, {
      content: "Prefers short coaching prompts",
      mode: "append",
    });

    expect(result.error).toBeDefined();
  });

  test("update_user_context appends and replaces context", async () => {
    await upsertCompanion(vault.db, { userId });

    const appendFirst = await call(tools.update_user_context, {
      content: "Prefers direct language.",
      mode: "append",
    });
    expect(appendFirst.updated).toBe(true);

    await call(tools.update_user_context, {
      content: "Wants weekly review on Sunday.",
      mode: "append",
    });

    const replaced = await call(tools.update_user_context, {
      content: "Only this note should remain.",
      mode: "replace",
    });

    expect(replaced.updated).toBe(true);
    expect(Number(replaced.length)).toBeGreaterThan(0);
  });
});
