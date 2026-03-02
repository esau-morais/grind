import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from "@ai-sdk/provider";

import {
  getConversationMessages,
  listConversations,
  type NormalizedGatewayEvent,
  type ForgeTickResult,
} from "@grindxp/core";
import { createTestVault, createTestUser, type TestVault } from "@grindxp/core/test-helpers";
import type { UserProfile } from "@grindxp/core";

import type { ChannelAdapter } from "./channel-adapter";

const usage: LanguageModelV3Usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function textChunks(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
  ];
}

let mockModel: InstanceType<typeof MockLanguageModelV3>;
let modelResponse: string;

mock.module("@grindxp/core", () => {
  const actual = require("@grindxp/core");
  return {
    ...actual,
    resolveModel: async () => mockModel,
  };
});

const { createChatResponder } = await import("./chat-responder");

let vault: TestVault;
let user: UserProfile;

function mockAdapter(channel = "test-channel"): ChannelAdapter & {
  sentTexts: Array<{ chatId: string; text: string }>;
  fetchedMedia: Array<unknown>;
} {
  const sentTexts: Array<{ chatId: string; text: string }> = [];
  const fetchedMedia: Array<unknown> = [];
  return {
    channel,
    sentTexts,
    fetchedMedia,
    async sendText(chatId, text) {
      sentTexts.push({ chatId, text });
    },
    async sendPermissionPrompt() {
      return "pm1";
    },
    async answerPermissionCallback() {},
    async editPermissionMessage() {},
    async fetchAttachment(media) {
      fetchedMedia.push(media);
      return {
        base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        mime: media.mime ?? "image/jpeg",
      };
    },
    formatReply(md) {
      return { text: md, chunks: [md] };
    },
    async sendToolOutput() {},
  };
}

function ev(
  payload: Record<string, unknown>,
  dedupeKey?: string,
): { normalized: NormalizedGatewayEvent; tick: ForgeTickResult } {
  const now = Date.now();
  return {
    normalized: {
      signal: {
        userId: user.id,
        source: "webhook",
        type: "context",
        confidence: 0.95,
        payload,
        detectedAt: now,
      },
      forgeEvent: { type: "webhook", payload, at: now, ...(dedupeKey ? { dedupeKey } : {}) },
    },
    tick: { executed: [], skipped: [], errors: [] } as unknown as ForgeTickResult,
  };
}

function msg(chatId: string, text: string, extra: Record<string, unknown> = {}, dk?: string) {
  return ev(
    {
      channel: "test-channel",
      eventName: "message.received",
      chatId,
      text,
      ...extra,
      ...(dk ? { messageId: dk } : {}),
    },
    dk,
  );
}

const cfg = (uid: string) => ({ userId: uid, ai: { provider: "anthropic", model: "test" } }) as any;
const gw = { enabled: true as const, host: "127.0.0.1", port: 5174, token: "t" };

beforeEach(async () => {
  vault = await createTestVault();
  user = await createTestUser(vault.db);
  modelResponse = "Hello from AI";
  mockModel = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: textChunks(modelResponse) }),
    }),
  });
});

afterEach(() => {
  vault.close();
});

describe("chat responder", () => {
  test("null when ai config missing", async () => {
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: { userId: user.id } as any,
      gateway: gw,
      adapter: mockAdapter(),
    });
    expect(r).toBeNull();
  });

  test("sends reply via adapter", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await r!.handle(msg("c1", "hi"));
    expect(a.sentTexts.length).toBe(1);
    expect(a.sentTexts[0]!.chatId).toBe("c1");
    expect(a.sentTexts[0]!.text).toContain("Hello from AI");
  });

  test("conversation prefix by channel", async () => {
    const a = mockAdapter("telegram");
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await r!.handle(msg("42", "x"));
    const cs = await listConversations(vault.db, user.id, 10);
    expect(cs[0]!.title).toBe("Telegram:42");
  });

  test("reuses conversation for same chatId", async () => {
    const a = mockAdapter("whatsapp");
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await r!.handle(msg("55", "a", {}, "d1"));
    await r!.handle(msg("55", "b", {}, "d2"));
    const cs = await listConversations(vault.db, user.id, 10);
    expect(cs.length).toBe(1);
    expect((await getConversationMessages(vault.db, cs[0]!.id, 20)).length).toBe(4);
  });

  test("deduplicates by dedupeKey", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await r!.handle(msg("c1", "first", {}, "same"));
    await r!.handle(msg("c1", "dup", {}, "same"));
    expect(a.sentTexts.length).toBe(1);
  });

  test("no dedupe without key", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await r!.handle(msg("c1", "a"));
    await r!.handle(msg("c1", "b"));
    expect(a.sentTexts.length).toBe(2);
  });

  test("inline base64 skips fetchAttachment", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    await r!.handle(msg("c1", "img", { inboundMedia: { base64: b64, mime: "image/png" } }));
    expect(a.fetchedMedia.length).toBe(0);
    const cs = await listConversations(vault.db, user.id, 10);
    const ms = await getConversationMessages(vault.db, cs[0]!.id, 10);
    const um = ms.find((m) => m.role === "user");
    expect(um?.attachments?.[0]?.base64).toBe(b64);
  });

  test("fileId media calls fetchAttachment", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await r!.handle(msg("c1", "photo", { inboundMedia: { fileId: "f1", mime: "image/jpeg" } }));
    expect(a.fetchedMedia.length).toBe(1);
    expect((a.fetchedMedia[0] as any).fileId).toBe("f1");
  });

  test("ignores non message.received", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await r!.handle(ev({ channel: "test-channel", eventName: "message.status", chatId: "c1" }));
    expect(a.sentTexts.length).toBe(0);
  });

  test("ignores event without chatId or content", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await r!.handle(ev({ channel: "test-channel", eventName: "message.received" }));
    expect(a.sentTexts.length).toBe(0);
  });

  test("model error → fallback reply + onWarn", async () => {
    mockModel = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error("API dead");
      },
    });
    const warns: string[] = [];
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
      onWarn: (m) => warns.push(m),
    });
    await r!.handle(msg("c1", "hi"));
    expect(a.sentTexts[0]!.text).toContain("error");
    expect(warns[0]).toContain("API dead");
  });

  test("empty model output → 'Got it.'", async () => {
    mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [{ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage }],
        }),
      }),
    });
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await r!.handle(msg("c1", "x"));
    expect(a.sentTexts[0]!.text).toBe("Got it.");
  });

  test("same-chat messages serialize in order", async () => {
    const order: number[] = [];
    let n = 0;
    mockModel = new MockLanguageModelV3({
      doStream: async () => {
        const i = ++n;
        if (i === 1) await Bun.sleep(30);
        order.push(i);
        return { stream: simulateReadableStream({ chunks: textChunks(`r${i}`) }) };
      },
    });
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await Promise.all([r!.handle(msg("s", "a", {}, "k1")), r!.handle(msg("s", "b", {}, "k2"))]);
    expect(order).toEqual([1, 2]);
  });

  test("persists user + assistant messages", async () => {
    modelResponse = "AI reply";
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await r!.handle(msg("c1", "user text"));
    const cs = await listConversations(vault.db, user.id, 10);
    const ms = (await getConversationMessages(vault.db, cs[0]!.id, 10)).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    expect(ms[0]!.role).toBe("user");
    expect(ms[0]!.content).toBe("user text");
    expect(ms[1]!.role).toBe("assistant");
    expect(ms[1]!.content).toBe("AI reply");
  });

  test("media-only (empty text) still processes", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    await r!.handle(msg("c1", "", { inboundMedia: { base64: b64, mime: "image/jpeg" } }));
    expect(a.sentTexts.length).toBe(1);
  });

  // --- trusted chat guard ---

  test("trustedChatId set: only trusted chat gets reply", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
      trustedChatId: "c1",
    });
    await r!.handle(msg("c2", "intruder"));
    await r!.handle(msg("c1", "owner"));
    expect(a.sentTexts.length).toBe(1);
    expect(a.sentTexts[0]!.chatId).toBe("c1");
  });

  test("trustedChatId set: untrusted chat silently ignored, no reply sent", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
      trustedChatId: "owner",
    });
    await r!.handle(msg("stranger", "hello?"));
    expect(a.sentTexts.length).toBe(0);
  });

  test("no trustedChatId: locks to first chatter, fires onFirstContact once", async () => {
    const a = mockAdapter();
    const contacts: string[] = [];
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
      onFirstContact: (id) => contacts.push(id),
    });
    await r!.handle(msg("c1", "first", {}, "d1"));
    await r!.handle(msg("c2", "intruder", {}, "d2"));
    await r!.handle(msg("c1", "also me", {}, "d3"));
    expect(contacts).toEqual(["c1"]);
    // c2 silently ignored, c1 gets both replies
    expect(a.sentTexts.map((s) => s.chatId)).toEqual(["c1", "c1"]);
  });

  test("no trustedChatId: multiple messages from same first chat all get replies", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
    });
    await r!.handle(msg("c1", "a", {}, "d1"));
    await r!.handle(msg("c1", "b", {}, "d2"));
    await r!.handle(msg("c1", "c", {}, "d3"));
    expect(a.sentTexts.length).toBe(3);
  });

  test("permission callback from untrusted chat is silently ignored", async () => {
    const a = mockAdapter();
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
      trustedChatId: "c1",
    });
    // callback_received from c2 (untrusted) — should not answer
    const callbackEvent = ev({
      channel: "test-channel",
      eventName: "callback.received",
      chatId: "c2",
      senderId: "u2",
      callbackData: "grindperm:some-id:once",
      callbackQueryId: "q2",
    });
    await r!.handle(callbackEvent);
    // no interaction with adapter expected (answerPermissionCallback not called)
    expect(a.sentTexts.length).toBe(0);
  });

  test("whatsapp: from field used as chatId when chatId absent", async () => {
    // WhatsApp Cloud normalizer sets payload.from, not payload.chatId
    const a = mockAdapter("whatsapp");
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
      trustedChatId: "5511999990000",
    });
    const waEvent = ev({
      channel: "whatsapp",
      eventName: "message.received",
      from: "5511999990000",
      text: "hello",
      messageId: "wamid.1",
    });
    await r!.handle(waEvent);
    expect(a.sentTexts.length).toBe(1);
    expect(a.sentTexts[0]!.chatId).toBe("5511999990000");
  });

  test("whatsapp: message from untrusted number silently dropped", async () => {
    const a = mockAdapter("whatsapp");
    const r = await createChatResponder({
      db: vault.db,
      userId: user.id,
      config: cfg(user.id),
      gateway: gw,
      adapter: a,
      trustedChatId: "5511999990000",
    });
    const waEvent = ev({
      channel: "whatsapp",
      eventName: "message.received",
      from: "5511888880000",
      text: "spam",
      messageId: "wamid.2",
    });
    await r!.handle(waEvent);
    expect(a.sentTexts.length).toBe(0);
  });
});
