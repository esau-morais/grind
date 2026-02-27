import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

import {
  createTestToolContext,
  createTestUser,
  createTestVault,
  type TestVault,
} from "../test-helpers";
import {
  insertForgeRule,
  listForgeRulesByUser as listForgeRules,
} from "../vault/repositories/forge";
import type { SystemPromptContext } from "./system-prompt";
import { runAgent, type AgentStreamEvent } from "./runtime";

const usage: LanguageModelV3Usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function toolCallStream(
  toolCallId: string,
  toolName: string,
  input: unknown,
): LanguageModelV3StreamResult {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
  ];
  return { stream: simulateReadableStream({ chunks }) };
}

function textStream(text: string): LanguageModelV3StreamResult {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
  ];
  return { stream: simulateReadableStream({ chunks }) };
}

function sequentialStreams(
  ...results: LanguageModelV3StreamResult[]
): () => Promise<LanguageModelV3StreamResult> {
  let i = 0;
  return async () => results[i++]!;
}

async function collectEvents(gen: AsyncGenerator<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

let vault: TestVault;
let userId: string;
let toolCtx: ReturnType<typeof createTestToolContext>;
let promptCtx: SystemPromptContext;

beforeEach(async () => {
  vault = await createTestVault();
  const user = await createTestUser(vault.db);
  userId = user.id;
  toolCtx = createTestToolContext(vault.db, userId);
  promptCtx = { user, quests: [], timer: null };
});

afterEach(() => {
  vault.close();
});

describe("eval: batch delete multi-step lifecycle", () => {
  test("agent executes batch_delete_forge_rules and DB is empty after", async () => {
    for (const name of ["Church Reminder A", "Church Reminder B", "Church Reminder C"]) {
      await insertForgeRule(vault.db, {
        userId,
        name,
        triggerType: "cron",
        triggerConfig: { cron: "0 9 * * 0", timezone: "America/Sao_Paulo" },
        actionType: "send-notification",
        actionConfig: { channel: "console", message: "Go to church" },
        enabled: true,
      });
    }

    const model = new MockLanguageModelV3({
      doStream: sequentialStreams(
        toolCallStream("call-delete", "batch_delete_forge_rules", {
          ruleSearches: ["Church Reminder A", "Church Reminder B", "Church Reminder C"],
        }),
        textStream("Deleted 3 rules."),
      ),
    });

    const events = await collectEvents(
      runAgent({
        model,
        toolCtx,
        promptCtx,
        messages: [{ role: "user", content: "Delete all of them." }],
      }),
    );

    const toolCallEvents = events.filter((e) => e.type === "tool-call");
    const toolResultEvents = events.filter((e) => e.type === "tool-result");

    expect(toolCallEvents).toHaveLength(1);
    expect(toolCallEvents[0]?.toolName).toBe("batch_delete_forge_rules");

    expect(toolResultEvents).toHaveLength(1);
    const result = toolResultEvents[0]?.toolResult as Record<string, unknown>;
    expect(result["ok"]).toBe(true);
    expect(result["deleted"]).toBe(3);
    expect(result["failed"]).toBe(0);

    expect(await listForgeRules(vault.db, userId)).toHaveLength(0);
    expect(events.at(-1)?.type).toBe("done");
  });
});

describe("eval: run-script self-correction", () => {
  test("agent handles ok:false and model retry succeeds — one rule persisted", async () => {
    const model = new MockLanguageModelV3({
      doStream: sequentialStreams(
        toolCallStream("call-bad", "create_forge_rule", {
          name: "Recreate Reminders",
          triggerType: "webhook",
          triggerConfig: {},
          actionType: "run-script",
          actionConfig: {},
          enabled: true,
        }),
        toolCallStream("call-good", "create_forge_rule", {
          name: "Recreate Reminders",
          triggerType: "webhook",
          triggerConfig: {},
          actionType: "run-script",
          actionConfig: { script: "#!/bin/bash\necho 'recreating church reminders'" },
          enabled: true,
        }),
        textStream("Created the run-script webhook rule."),
      ),
    });

    const events = await collectEvents(
      runAgent({
        model,
        toolCtx,
        promptCtx,
        messages: [{ role: "user", content: "Create a webhook run-script rule." }],
      }),
    );

    const createCallEvents = events.filter(
      (e) => e.type === "tool-call" && e.toolName === "create_forge_rule",
    );
    const createResultEvents = events.filter(
      (e) => e.type === "tool-result" && e.toolName === "create_forge_rule",
    );

    expect(createCallEvents).toHaveLength(2);
    expect(createResultEvents).toHaveLength(2);

    const firstResult = createResultEvents[0]?.toolResult as Record<string, unknown>;
    expect(firstResult["ok"]).toBe(false);
    expect(String(firstResult["error"]).toLowerCase()).toContain("script");

    const secondResult = createResultEvents[1]?.toolResult as Record<string, unknown>;
    expect(secondResult["ok"]).toBe(true);

    const rules = await listForgeRules(vault.db, userId);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.actionType).toBe("run-script");
  });
});

describe("eval: webhook rule creation", () => {
  test("agent creates webhook rule and it persists in DB with correct triggerType", async () => {
    const model = new MockLanguageModelV3({
      doStream: sequentialStreams(
        toolCallStream("call-webhook", "create_forge_rule", {
          name: "Recreate Church Reminders",
          triggerType: "webhook",
          triggerConfig: {},
          actionType: "run-script",
          actionConfig: { script: "echo recreating" },
          enabled: true,
        }),
        textStream("Webhook rule created."),
      ),
    });

    const events = await collectEvents(
      runAgent({
        model,
        toolCtx,
        promptCtx,
        messages: [{ role: "user", content: "Replace cron rules with a webhook." }],
      }),
    );

    const toolResultEvents = events.filter((e) => e.type === "tool-result");
    expect(toolResultEvents).toHaveLength(1);

    const result = toolResultEvents[0]?.toolResult as Record<string, unknown>;
    expect(result["ok"]).toBe(true);
    const rule = result["rule"] as Record<string, unknown>;
    expect(rule["triggerType"]).toBe("webhook");

    const rules = await listForgeRules(vault.db, userId);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.triggerType).toBe("webhook");
  });
});
