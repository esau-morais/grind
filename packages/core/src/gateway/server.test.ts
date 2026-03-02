import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createTestVault, createTestUser, type TestVault } from "../test-helpers";
import { startGatewayServer, type GatewayServer } from "./server";

let vault: TestVault;
let userId: string;
let gateway: GatewayServer;
const TOKEN = "test-gateway-token-abc123";

beforeEach(async () => {
  vault = await createTestVault();
  const user = await createTestUser(vault.db);
  userId = user.id;
});

afterEach(async () => {
  if (gateway) await gateway.stop(true);
  vault.close();
});

function start(overrides: Partial<Parameters<typeof startGatewayServer>[0]> = {}) {
  gateway = startGatewayServer({
    db: vault.db,
    userId,
    token: TOKEN,
    host: "127.0.0.1",
    port: 0,
    ...overrides,
  });
  return gateway;
}

describe("gateway server routing", () => {
  test("health endpoint", async () => {
    start();
    const res = await fetch(`${gateway.url}health`);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  test("unauthorized inbound is rejected", async () => {
    start();
    const res = await fetch(`${gateway.url}hooks/inbound`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "context", payload: {} }),
    });
    expect(res.status).toBe(401);
  });

  test("onChannelEvent fires for each channel endpoint", async () => {
    const channels: string[] = [];
    start({
      onChannelEvent: (e) => {
        const ch = e.normalized.forgeEvent.payload.channel;
        if (typeof ch === "string") channels.push(ch);
      },
    });

    await fetch(`${gateway.url}hooks/telegram`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 1,
        message: { date: 1700000000, text: "t", chat: { id: 1 }, from: { id: 2 } },
      }),
    });

    await fetch(`${gateway.url}hooks/whatsapp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "b",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: "p" },
                  messages: [
                    {
                      id: "w1",
                      from: "55",
                      timestamp: "1700000000",
                      type: "text",
                      text: { body: "w" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });

    await fetch(`${gateway.url}hooks/inbound`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        type: "context",
        payload: { channel: "discord", eventName: "message.received", chatId: "c1", text: "d" },
        eventPayload: {
          channel: "discord",
          eventName: "message.received",
          chatId: "c1",
          text: "d",
        },
        dedupeKey: "d:1",
      }),
    });

    await Bun.sleep(150);
    expect(channels).toContain("telegram");
    expect(channels).toContain("whatsapp");
    expect(channels).toContain("discord");
  });

  test("onChannelEvent fires for telegram webhook", async () => {
    let channelFired = false;
    start({
      onChannelEvent: () => {
        channelFired = true;
      },
    });

    await fetch(`${gateway.url}hooks/telegram`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 2,
        message: { date: 1700000000, text: "x", chat: { id: 1 }, from: { id: 2 } },
      }),
    });

    await Bun.sleep(100);
    expect(channelFired).toBe(true);
  });

  test("onWarn fires when onChannelEvent throws", async () => {
    const warns: string[] = [];
    start({
      onChannelEvent: () => {
        throw new Error("boom");
      },
      onWarn: (msg) => warns.push(msg),
    });

    await fetch(`${gateway.url}hooks/telegram`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 3,
        message: { date: 1700000000, text: "x", chat: { id: 1 }, from: { id: 2 } },
      }),
    });

    await Bun.sleep(100);
    expect(warns.some((w) => w.includes("boom"))).toBe(true);
  });
});

describe("gateway /send/:channel endpoint", () => {
  test("sends via onSendMessage and returns ok", async () => {
    const sent: Array<{ channel: string; chatId: string; text: string }> = [];
    start({
      onSendMessage: async (channel, chatId, text) => {
        sent.push({ channel, chatId, text });
      },
    });

    const res = await fetch(`${gateway.url}send/discord`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ chatId: "ch1", text: "hello" }),
    });

    const body = (await res.json()) as { ok: boolean; channel: string; chatId: string };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.channel).toBe("discord");
    expect(body.chatId).toBe("ch1");
    expect(sent).toEqual([{ channel: "discord", chatId: "ch1", text: "hello" }]);
  });

  test("rejects unauthorized send", async () => {
    start({
      onSendMessage: async () => {},
    });

    const res = await fetch(`${gateway.url}send/discord`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "ch1", text: "hi" }),
    });

    expect(res.status).toBe(401);
  });

  test("returns 503 when no onSendMessage registered", async () => {
    start();

    const res = await fetch(`${gateway.url}send/whatsapp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ chatId: "55999", text: "hi" }),
    });

    expect(res.status).toBe(503);
  });

  test("returns 400 when chatId missing", async () => {
    start({ onSendMessage: async () => {} });

    const res = await fetch(`${gateway.url}send/discord`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });

    expect(res.status).toBe(400);
  });

  test("returns 400 when text missing", async () => {
    start({ onSendMessage: async () => {} });

    const res = await fetch(`${gateway.url}send/discord`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ chatId: "ch1" }),
    });

    expect(res.status).toBe(400);
  });

  test("returns 500 when onSendMessage throws", async () => {
    start({
      onSendMessage: async () => {
        throw new Error("adapter offline");
      },
    });

    const res = await fetch(`${gateway.url}send/discord`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ chatId: "ch1", text: "hi" }),
    });

    const body = (await res.json()) as { ok: boolean; error: string };
    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("adapter offline");
  });

  test("routes to correct channel from path", async () => {
    const channels: string[] = [];
    start({
      onSendMessage: async (channel) => {
        channels.push(channel);
      },
    });

    for (const ch of ["telegram", "discord", "whatsapp", "whatsapp-web"]) {
      await fetch(`${gateway.url}send/${ch}`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ chatId: "x", text: "y" }),
      });
    }

    expect(channels).toEqual(["telegram", "discord", "whatsapp", "whatsapp-web"]);
  });
});
