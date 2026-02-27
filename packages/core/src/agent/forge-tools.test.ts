import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createGrindTools } from "./tools";
import { buildStablePrompt } from "./system-prompt";

const stubCtx = {
  db: {} as never,
  userId: "test-user",
  timerPath: "/tmp/test-timer",
  trustLevel: 4,
} as const;

const tools = createGrindTools(stubCtx);

function schema(toolName: keyof typeof tools): z.ZodTypeAny {
  return (tools[toolName] as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
}

function fieldDesc(s: z.ZodTypeAny, field: string): string {
  const shape = (s as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
  return (shape[field]?._def as { description?: string } | undefined)?.description ?? "";
}

function innerSchema(s: z.ZodTypeAny): z.AnyZodObject {
  return (s as z.ZodEffects<z.AnyZodObject>).innerType();
}

describe("forge tool registration", () => {
  test("batch_delete_forge_rules is registered", () => {
    expect("batch_delete_forge_rules" in tools).toBe(true);
  });

  test("create_forge_rule is registered", () => {
    expect("create_forge_rule" in tools).toBe(true);
  });

  test("update_forge_rule is registered", () => {
    expect("update_forge_rule" in tools).toBe(true);
  });
});

describe("create_forge_rule schema descriptions", () => {
  const s = schema("create_forge_rule");

  test("triggerType describes when to use webhook, cron, manual", () => {
    const desc = fieldDesc(s, "triggerType");
    expect(desc).toContain("webhook");
    expect(desc).toContain("cron");
    expect(desc).toContain("manual");
  });

  test("triggerConfig provides a concrete cron example with timezone", () => {
    const desc = fieldDesc(s, "triggerConfig");
    expect(desc).toContain("cron");
    expect(desc).toContain("timezone");
  });

  test("actionType lists all four action types including run-script", () => {
    const desc = fieldDesc(s, "actionType");
    expect(desc).toContain("run-script");
    expect(desc).toContain("send-notification");
    expect(desc).toContain("queue-quest");
    expect(desc).toContain("log-to-vault");
  });

  test("actionConfig marks script as REQUIRED for run-script", () => {
    const desc = fieldDesc(s, "actionConfig");
    expect(desc).toContain("run-script");
    expect(desc).toContain("REQUIRED");
    expect(desc).toContain("script");
  });

  test("actionConfig no longer has .default({}) that silently accepts empty object", () => {
    const shape = (s as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    const typeName = (shape["actionConfig"]?._def as { typeName?: string } | undefined)?.typeName;
    expect(typeName).not.toBe("ZodDefault");
  });
});

describe("update_forge_rule schema descriptions", () => {
  const inner = innerSchema(schema("update_forge_rule"));

  test("triggerType describes webhook", () => {
    const desc = fieldDesc(inner, "triggerType");
    expect(desc).toContain("webhook");
  });

  test("actionType mentions run-script", () => {
    const desc = fieldDesc(inner, "actionType");
    expect(desc).toContain("run-script");
  });

  test("actionConfig marks script as REQUIRED for run-script", () => {
    const desc = fieldDesc(inner, "actionConfig");
    expect(desc).toContain("run-script");
    expect(desc).toContain("REQUIRED");
  });
});

describe("batch_delete_forge_rules schema", () => {
  const batchSchema = z.object({
    ruleSearches: z.array(z.string().min(1)).min(1),
  });

  test("accepts array of rule searches", () => {
    expect(batchSchema.safeParse({ ruleSearches: ["rule-abc", "rule-xyz"] }).success).toBe(true);
  });

  test("rejects empty array", () => {
    expect(batchSchema.safeParse({ ruleSearches: [] }).success).toBe(false);
  });

  test("rejects missing ruleSearches", () => {
    expect(batchSchema.safeParse({}).success).toBe(false);
  });

  test("rejects empty string entries", () => {
    expect(batchSchema.safeParse({ ruleSearches: [""] }).success).toBe(false);
  });

  test("registered tool inputSchema also rejects empty array", () => {
    const s = schema("batch_delete_forge_rules") as z.AnyZodObject;
    expect(s.safeParse({ ruleSearches: [] }).success).toBe(false);
  });
});

describe("system prompt forge section", () => {
  const prompt = buildStablePrompt(null);

  test("removed: verbose run-script retry instruction", () => {
    expect(prompt).not.toContain("fix the payload and call the tool again immediately");
    expect(prompt).not.toContain("actionConfig MUST include");
  });

  test("removed: redundant forge trigger selection block", () => {
    expect(prompt).not.toContain("Forge trigger selection:");
  });

  test("present: batch_delete_forge_rules reference", () => {
    expect(prompt).toContain("batch_delete_forge_rules");
  });

  test("present: webhook trigger conversion guidance", () => {
    expect(prompt).toContain("webhook");
  });
});
