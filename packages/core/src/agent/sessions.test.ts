import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createTestUser, createTestVault, type TestVault } from "../test-helpers";
import {
  appendMessage,
  createConversation,
  getConversationById,
  getConversationMessages,
  getLatestConversation,
  getToolPermissions,
  grantToolPermission,
  listConversations,
  storedToModelMessages,
  updateConversationTitle,
} from "./sessions";

let vault: TestVault;
let userId: string;

beforeEach(async () => {
  vault = await createTestVault();
  const user = await createTestUser(vault.db);
  userId = user.id;
});

afterEach(() => {
  vault.close();
});

describe("createConversation", () => {
  test("creates a conversation with optional title", async () => {
    const conv = await createConversation(vault.db, userId, "Test Convo");
    expect(conv.id).toBeString();
    expect(conv.userId).toBe(userId);
    expect(conv.title).toBe("Test Convo");
    expect(conv.createdAt).toBeNumber();
  });

  test("title defaults to null when omitted", async () => {
    const conv = await createConversation(vault.db, userId);
    expect(conv.title).toBeNull();
  });
});

describe("getLatestConversation", () => {
  test("returns null for user with no conversations", async () => {
    const conv = await getLatestConversation(vault.db, userId);
    expect(conv).toBeNull();
  });

  test("returns most recently updated conversation", async () => {
    await createConversation(vault.db, userId, "Old");
    await new Promise((r) => setTimeout(r, 5));
    const newer = await createConversation(vault.db, userId, "New");

    const latest = await getLatestConversation(vault.db, userId);
    expect(latest?.id).toBe(newer.id);
  });
});

describe("getConversationById", () => {
  test("returns conversation by id", async () => {
    const created = await createConversation(vault.db, userId, "My Conv");
    const found = await getConversationById(vault.db, created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.title).toBe("My Conv");
  });

  test("returns null for unknown id", async () => {
    const found = await getConversationById(vault.db, "nonexistent");
    expect(found).toBeNull();
  });
});

describe("listConversations", () => {
  test("returns all conversations ordered by updatedAt desc", async () => {
    const c1 = await createConversation(vault.db, userId, "First");
    await new Promise((r) => setTimeout(r, 5));
    const c2 = await createConversation(vault.db, userId, "Second");

    const list = await listConversations(vault.db, userId);
    expect(list[0]?.id).toBe(c2.id);
    expect(list[1]?.id).toBe(c1.id);
  });

  test("limits results", async () => {
    for (let i = 0; i < 5; i++) {
      await createConversation(vault.db, userId, `Conv ${i}`);
    }
    const list = await listConversations(vault.db, userId, 3);
    expect(list).toHaveLength(3);
  });
});

describe("updateConversationTitle", () => {
  test("updates the title", async () => {
    const conv = await createConversation(vault.db, userId, "Old Title");
    await updateConversationTitle(vault.db, conv.id, "New Title");
    const updated = await getConversationById(vault.db, conv.id);
    expect(updated?.title).toBe("New Title");
  });
});

describe("appendMessage", () => {
  test("inserts a user message", async () => {
    const conv = await createConversation(vault.db, userId);
    const msg = await appendMessage(vault.db, conv.id, { role: "user", content: "Hello" });
    expect(msg.id).toBeString();
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello");
  });

  test("inserts an assistant message", async () => {
    const conv = await createConversation(vault.db, userId);
    const msg = await appendMessage(vault.db, conv.id, {
      role: "assistant",
      content: "Hi there",
    });
    expect(msg.role).toBe("assistant");
  });

  test("updates conversation updatedAt", async () => {
    const conv = await createConversation(vault.db, userId);
    const before = conv.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await appendMessage(vault.db, conv.id, { role: "user", content: "ping" });
    const updated = await getConversationById(vault.db, conv.id);
    expect(updated?.updatedAt).toBeGreaterThan(before);
  });
});

describe("getConversationMessages", () => {
  test("returns messages newest-first (desc createdAt)", async () => {
    const conv = await createConversation(vault.db, userId);
    await appendMessage(vault.db, conv.id, { role: "user", content: "First" });
    await new Promise((r) => setTimeout(r, 5));
    await appendMessage(vault.db, conv.id, { role: "assistant", content: "Second" });

    const msgs = await getConversationMessages(vault.db, conv.id);
    expect(msgs[0]?.content).toBe("Second");
    expect(msgs[1]?.content).toBe("First");
  });

  test("returns empty array for conversation with no messages", async () => {
    const conv = await createConversation(vault.db, userId);
    const msgs = await getConversationMessages(vault.db, conv.id);
    expect(msgs).toHaveLength(0);
  });
});

describe("storedToModelMessages", () => {
  test("converts user and assistant messages to ModelMessage format", () => {
    const stored = [
      {
        id: "1",
        conversationId: "c1",
        role: "user",
        content: "Hello",
        toolCalls: null,
        toolResults: null,
        attachments: null,
        createdAt: 1000,
      },
      {
        id: "2",
        conversationId: "c1",
        role: "assistant",
        content: "Hi",
        toolCalls: null,
        toolResults: null,
        attachments: null,
        createdAt: 2000,
      },
    ];

    const messages = storedToModelMessages(stored);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
  });

  test("sorts by createdAt ascending", () => {
    const stored = [
      {
        id: "2",
        conversationId: "c1",
        role: "assistant",
        content: "Second",
        toolCalls: null,
        toolResults: null,
        attachments: null,
        createdAt: 2000,
      },
      {
        id: "1",
        conversationId: "c1",
        role: "user",
        content: "First",
        toolCalls: null,
        toolResults: null,
        attachments: null,
        createdAt: 1000,
      },
    ];

    const messages = storedToModelMessages(stored);
    expect((messages[0] as { content: string }).content).toBe("First");
    expect((messages[1] as { content: string }).content).toBe("Second");
  });

  test("user message with attachments becomes content array", () => {
    const stored = [
      {
        id: "1",
        conversationId: "c1",
        role: "user",
        content: "See image",
        toolCalls: null,
        toolResults: null,
        attachments: [{ mime: "image/png", base64: "abc123" }],
        createdAt: 1000,
      },
    ];

    const messages = storedToModelMessages(stored);
    const msg = messages[0];
    expect(Array.isArray(msg?.content)).toBe(true);
    if (Array.isArray(msg?.content)) {
      expect(msg.content).toHaveLength(2);
      expect(msg.content[0]).toMatchObject({ type: "image" });
      expect(msg.content[1]).toMatchObject({ type: "text", text: "See image" });
    }
  });
});

describe("getToolPermissions / grantToolPermission", () => {
  test("new user has no permissions", async () => {
    const perms = await getToolPermissions(vault.db, userId);
    expect(perms).toHaveLength(0);
  });

  test("granted permission appears in list", async () => {
    await grantToolPermission(vault.db, userId, "bash");
    const perms = await getToolPermissions(vault.db, userId);
    expect(perms).toContain("bash");
  });

  test("granting same permission twice is idempotent", async () => {
    await grantToolPermission(vault.db, userId, "bash");
    await grantToolPermission(vault.db, userId, "bash");
    const perms = await getToolPermissions(vault.db, userId);
    expect(perms.filter((p) => p === "bash")).toHaveLength(1);
  });

  test("multiple different permissions can be granted", async () => {
    await grantToolPermission(vault.db, userId, "bash");
    await grantToolPermission(vault.db, userId, "web_search");
    const perms = await getToolPermissions(vault.db, userId);
    expect(perms).toContain("bash");
    expect(perms).toContain("web_search");
  });
});
