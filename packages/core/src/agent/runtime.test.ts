import { describe, expect, test } from "bun:test";

import { CONTEXT_LIMITS, estimateTokens, getContextLimit } from "./runtime";

describe("estimateTokens", () => {
  test("empty string = 0 tokens", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("approximates ~4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  test("rounds to nearest integer", () => {
    const result = estimateTokens("abc");
    expect(Number.isInteger(result)).toBe(true);
  });

  test("never returns negative", () => {
    expect(estimateTokens("")).toBeGreaterThanOrEqual(0);
  });
});

describe("getContextLimit", () => {
  test("matches known claude-sonnet pattern", () => {
    const model = { modelId: "claude-sonnet-4-5", doGenerate: async () => ({}) as never } as never;
    expect(getContextLimit(model)).toBe(200_000);
  });

  test('claude-3-haiku-latest falls to default: "claude-haiku" pattern does not substring-match "claude-3-haiku-latest"', () => {
    // BUG: CONTEXT_LIMITS key 'claude-haiku' does not match 'claude-3-haiku-latest'
    // because 'claude-3-haiku-latest'.includes('claude-haiku') is false (has '3-' between)
    const model = {
      modelId: "claude-3-haiku-latest",
      doGenerate: async () => ({}) as never,
    } as never;
    expect(getContextLimit(model)).toBe(128_000);
  });

  test('exact "claude-haiku" modelId matches the pattern', () => {
    const model = { modelId: "claude-haiku", doGenerate: async () => ({}) as never } as never;
    expect(getContextLimit(model)).toBe(200_000);
  });

  test("matches gpt-4o pattern", () => {
    const model = { modelId: "gpt-4o", doGenerate: async () => ({}) as never } as never;
    expect(getContextLimit(model)).toBe(128_000);
  });

  test("matches gemini-2.0-flash pattern", () => {
    const model = {
      modelId: "gemini-2.0-flash-exp",
      doGenerate: async () => ({}) as never,
    } as never;
    expect(getContextLimit(model)).toBe(1_000_000);
  });

  test("unknown model: returns default 128k", () => {
    const model = {
      modelId: "some-unknown-model-v99",
      doGenerate: async () => ({}) as never,
    } as never;
    expect(getContextLimit(model)).toBe(128_000);
  });
});
