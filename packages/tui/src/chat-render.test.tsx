import { describe, expect, test } from "bun:test";

import type { GrindConfig, UserProfile } from "@grindxp/core";
import type { CompanionInsightRow, CompanionSettingsRow } from "@grindxp/core/vault";
import type { Root } from "@opentui/react";
import { ChatApp } from "./ChatApp";
import { renderChat } from "./chat-render";

function makeConfig(): GrindConfig {
  return {
    userId: "user-1",
    encryptionKey: "enc",
    vaultPath: "/tmp/vault.db",
    createdAt: Date.now(),
    ai: { provider: "openai", model: "gpt-4o-mini" },
  };
}

function makeUser(): UserProfile {
  return {
    id: "user-1",
    displayName: "Alex",
    level: 1,
    totalXp: 0,
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

function findElementByType(node: unknown, type: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type) {
    return element.props ?? null;
  }

  const children = element.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElementByType(child, type);
      if (found) return found;
    }
    return null;
  }

  return findElementByType(children, type);
}

describe("renderChat prompt context wiring", () => {
  test("passes companion insights to ChatApp prompt context when provided", () => {
    let capturedTree: unknown;
    const root = {
      render: (tree: unknown) => {
        capturedTree = tree;
      },
    } as unknown as Root;

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
      userContext: null,
      config: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const insights: CompanionInsightRow[] = [
      {
        id: "insight-1",
        userId: "user-1",
        category: "goal",
        content: "Run 3 times/week",
        confidence: 0.9,
        source: "user-stated",
        metadata: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    renderChat(root, {
      config: makeConfig(),
      db: {} as never,
      close: () => {},
      user: makeUser(),
      timerPath: "/tmp/timer.json",
      model: { modelId: "gpt-4o-mini", doGenerate: async () => ({}) as never } as never,
      quests: [],
      timer: null,
      userId: "user-1",
      companion,
      companionInsights: insights,
      initialToolPermissions: [],
    });

    const chatAppProps = findElementByType(capturedTree, ChatApp);
    expect(chatAppProps).not.toBeNull();
    const promptCtx = chatAppProps?.promptCtx as Record<string, unknown>;

    expect(promptCtx.companion).toEqual(companion);
    expect(promptCtx.companionInsights).toEqual(insights);
  });

  test("omits companion fields from prompt context when not provided", () => {
    let capturedTree: unknown;
    const root = {
      render: (tree: unknown) => {
        capturedTree = tree;
      },
    } as unknown as Root;

    renderChat(root, {
      config: makeConfig(),
      db: {} as never,
      close: () => {},
      user: makeUser(),
      timerPath: "/tmp/timer.json",
      model: { modelId: "gpt-4o-mini", doGenerate: async () => ({}) as never } as never,
      quests: [],
      timer: null,
      userId: "user-1",
      initialToolPermissions: [],
    });

    const chatAppProps = findElementByType(capturedTree, ChatApp);
    expect(chatAppProps).not.toBeNull();
    const promptCtx = chatAppProps?.promptCtx as Record<string, unknown>;

    expect(Object.hasOwn(promptCtx, "companion")).toBe(false);
    expect(Object.hasOwn(promptCtx, "companionInsights")).toBe(false);
  });
});
