import { describe, expect, test } from "bun:test";

import { createDiscordAdapter } from "./discord-adapter";
import { createWhatsAppCloudAdapter } from "./whatsapp-cloud-adapter";
import { createWhatsAppWebAdapter } from "./whatsapp-web-adapter";

describe("discord adapter", () => {
  const adapter = createDiscordAdapter({ botToken: "fake" });

  test("formatReply returns single chunk for short text", () => {
    const result = adapter.formatReply("hello");
    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0]).toBe("hello");
  });

  test("formatReply splits at 2000 chars", () => {
    const text = "a".repeat(2500);
    const result = adapter.formatReply(text);
    expect(result.chunks.length).toBe(2);
    expect(result.chunks[0]!.length).toBeLessThanOrEqual(2000);
    expect(result.chunks[0]!.length + result.chunks[1]!.length).toBe(2500);
  });

  test("formatReply prefers paragraph breaks", () => {
    const para1 = "a".repeat(1500);
    const para2 = "b".repeat(800);
    const text = `${para1}\n\n${para2}`;
    const result = adapter.formatReply(text);
    expect(result.chunks.length).toBe(2);
    expect(result.chunks[0]).toBe(para1);
    expect(result.chunks[1]).toBe(para2);
  });

  test("formatReply prefers line breaks over hard cut", () => {
    const line1 = "a".repeat(1800);
    const line2 = "b".repeat(300);
    const text = `${line1}\n${line2}`;
    const result = adapter.formatReply(text);
    expect(result.chunks.length).toBe(2);
    expect(result.chunks[0]).toBe(line1);
    expect(result.chunks[1]).toBe(line2);
  });

  test("formatReply handles exactly 2000 chars", () => {
    const text = "x".repeat(2000);
    const result = adapter.formatReply(text);
    expect(result.chunks.length).toBe(1);
  });
});

describe("whatsapp cloud adapter", () => {
  const adapter = createWhatsAppCloudAdapter({
    phoneNumberId: "fake",
    accessToken: "fake",
  });

  test("formatReply returns single chunk for short text", () => {
    const result = adapter.formatReply("short message");
    expect(result.chunks.length).toBe(1);
  });

  test("formatReply splits at 4096 chars", () => {
    const text = "b".repeat(5000);
    const result = adapter.formatReply(text);
    expect(result.chunks.length).toBe(2);
    expect(result.chunks[0]!.length).toBeLessThanOrEqual(4096);
  });

  test("formatReply handles exactly 4096 chars", () => {
    const text = "y".repeat(4096);
    const result = adapter.formatReply(text);
    expect(result.chunks.length).toBe(1);
  });
});

describe("whatsapp web adapter", () => {
  const adapter = createWhatsAppWebAdapter({
    sendMessage: async () => null,
  });

  test("formatReply returns single chunk for short text", () => {
    const result = adapter.formatReply("hi");
    expect(result.chunks.length).toBe(1);
  });

  test("formatReply splits at 4096 chars", () => {
    const text = "c".repeat(6000);
    const result = adapter.formatReply(text);
    expect(result.chunks.length).toBe(2);
    expect(result.chunks[0]!.length).toBeLessThanOrEqual(4096);
  });

  test("formatReply preserves paragraph boundaries", () => {
    const p1 = "d".repeat(3000);
    const p2 = "e".repeat(2000);
    const text = `${p1}\n\n${p2}`;
    const result = adapter.formatReply(text);
    expect(result.chunks.length).toBe(2);
    expect(result.chunks[0]).toBe(p1);
    expect(result.chunks[1]).toBe(p2);
  });
});
