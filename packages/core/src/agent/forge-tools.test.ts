import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createGrindTools } from "./tools";

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

describe("create_forge_rule schema contracts", () => {
  const s = schema("create_forge_rule");

  test("triggerType mentions webhook", () => {
    const desc = fieldDesc(s, "triggerType");
    expect(desc).toContain("webhook");
  });

  test("actionType mentions run-script", () => {
    const desc = fieldDesc(s, "actionType");
    expect(desc).toContain("run-script");
  });

  test("actionConfig marks script as REQUIRED", () => {
    const desc = fieldDesc(s, "actionConfig");
    expect(desc).toContain("REQUIRED");
    expect(desc).toContain("script");
  });

  test("actionConfig no longer has .default({}) that silently accepts empty object", () => {
    const shape = (s as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    const typeName = (shape["actionConfig"]?._def as { typeName?: string } | undefined)?.typeName;
    expect(typeName).not.toBe("ZodDefault");
  });
});

describe("update_forge_rule schema contracts", () => {
  const inner = innerSchema(schema("update_forge_rule"));

  test("triggerType describes webhook", () => {
    const desc = fieldDesc(inner, "triggerType");
    expect(desc).toContain("webhook");
  });

  test("actionConfig marks script as REQUIRED for run-script", () => {
    const desc = fieldDesc(inner, "actionConfig");
    expect(desc).toContain("run-script");
    expect(desc).toContain("REQUIRED");
  });
});

describe("batch_delete_forge_rules schema", () => {
  test("registered tool inputSchema accepts non-empty arrays", () => {
    const s = schema("batch_delete_forge_rules") as z.AnyZodObject;
    expect(s.safeParse({ ruleSearches: ["rule-abc", "rule-xyz"] }).success).toBe(true);
  });

  test("registered tool inputSchema also rejects empty array", () => {
    const s = schema("batch_delete_forge_rules") as z.AnyZodObject;
    expect(s.safeParse({ ruleSearches: [] }).success).toBe(false);
  });
});
