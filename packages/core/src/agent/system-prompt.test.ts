import { describe, expect, test } from "bun:test";

import type { Quest, UserProfile } from "../schema";
import type { CompanionInsightRow, CompanionSettingsRow } from "../vault/schema";
import { buildDynamicPrompt, buildStablePrompt } from "./system-prompt";

function makeUser(): UserProfile {
  return {
    id: "user-1",
    displayName: "Alex",
    level: 3,
    totalXp: 420,
    preferences: {
      timezone: "UTC",
      locale: "en-US",
      notificationsEnabled: true,
      companionEnabled: true,
    },
    metadata: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeInsight(index: number, category: "pattern" | "preference"): CompanionInsightRow {
  return {
    id: `insight-${index}`,
    userId: "user-1",
    category,
    content: `insight ${index}`,
    confidence: 0.5 + index / 100,
    source: "ai-observed",
    metadata: {},
    createdAt: Date.now() - index,
    updatedAt: Date.now() - index,
  };
}

describe("buildStablePrompt companion identity", () => {
  test("uses companion name and emoji in identity when provided", () => {
    const companion: CompanionSettingsRow = {
      id: "companion-1",
      userId: "user-1",
      name: "Sparky",
      emoji: "🔥",
      mode: "suggest",
      trustLevel: 0,
      trustScore: 0,
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
      systemPrompt: null,
      userContext: null,
      config: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const prompt = buildStablePrompt(companion);
    expect(prompt).toContain("You are Sparky (🔥)");
    expect(prompt).toContain("Your name is Sparky");
    expect(prompt).not.toContain("You are GRIND");
  });

  test('falls back to "Companion" and "⚡" when name/emoji are null', () => {
    const prompt = buildStablePrompt(null);
    expect(prompt).toContain("You are Companion (⚡)");
    expect(prompt).toContain("Your name is Companion");
  });

  test('falls back to "Companion" and "⚡" when companion has no name/emoji', () => {
    const companion: CompanionSettingsRow = {
      id: "companion-1",
      userId: "user-1",
      name: null,
      emoji: null,
      mode: "suggest",
      trustLevel: 0,
      trustScore: 0,
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
      systemPrompt: null,
      userContext: null,
      config: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const prompt = buildStablePrompt(companion);
    expect(prompt).toContain("You are Companion (⚡)");
  });
});

describe("buildDynamicPrompt companion memory sections", () => {
  test("includes grouped companion insights and caps output to 12 entries", () => {
    const insights = Array.from({ length: 15 }, (_, i) =>
      makeInsight(i + 1, i % 2 === 0 ? "pattern" : "preference"),
    );

    const prompt = buildDynamicPrompt({
      user: makeUser(),
      quests: [] as Quest[],
      timer: null,
      companionInsights: insights,
    });

    expect(prompt).toContain("COMPANION INSIGHTS:");
    expect(prompt).toContain("PATTERN:");
    expect(prompt).toContain("PREFERENCE:");

    const insightBulletCount = (prompt.match(/\n  - \(/g) ?? []).length;
    expect(insightBulletCount).toBe(12);
    expect(prompt).toContain("(51%) insight 1");
  });

  test("omits companion insights section when no insights are provided", () => {
    const prompt = buildDynamicPrompt({
      user: makeUser(),
      quests: [] as Quest[],
      timer: null,
    });

    expect(prompt).not.toContain("COMPANION INSIGHTS:");
  });

  test("includes companion user context when present", () => {
    const companion: CompanionSettingsRow = {
      id: "companion-1",
      userId: "user-1",
      name: "Coach",
      emoji: null,
      mode: "suggest",
      trustLevel: 0,
      trustScore: 0,
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
      systemPrompt: null,
      userContext: "Prefers concise feedback.",
      config: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const prompt = buildDynamicPrompt({
      user: makeUser(),
      quests: [] as Quest[],
      timer: null,
      companion,
    });

    expect(prompt).toContain("USER CONTEXT:");
    expect(prompt).toContain("Prefers concise feedback.");
  });
});
