import { describe, expect, test } from "bun:test";

import { compactMessages } from "./compaction";
import type { ModelMessage } from "ai";

function makeMessages(count: number): ModelMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `Message ${i + 1}`,
  }));
}

describe("compactMessages", () => {
  test("no compaction needed when messages <= keepCount", () => {
    const messages = makeMessages(5);
    const result = compactMessages({ messages, keepCount: 5, summary: "summary" });
    expect(result.messages).toHaveLength(5);
    expect(result.dropped).toBe(0);
  });

  test("no compaction when messages < keepCount", () => {
    const messages = makeMessages(3);
    const result = compactMessages({ messages, keepCount: 10, summary: "summary" });
    expect(result.messages).toHaveLength(3);
    expect(result.dropped).toBe(0);
  });

  test("compacts when messages > keepCount", () => {
    const messages = makeMessages(10);
    const result = compactMessages({ messages, keepCount: 4, summary: "The summary" });
    expect(result.dropped).toBe(6);
    expect(result.messages).toHaveLength(5);
  });

  test("keeps the most recent messages", () => {
    const messages = makeMessages(10);
    const result = compactMessages({ messages, keepCount: 3, summary: "summary" });
    const kept = result.messages.slice(1);
    expect(kept).toHaveLength(3);
    expect((kept[0] as { content: string }).content).toBe("Message 8");
    expect((kept[1] as { content: string }).content).toBe("Message 9");
    expect((kept[2] as { content: string }).content).toBe("Message 10");
  });

  test("prepends a system summary message", () => {
    const messages = makeMessages(10);
    const result = compactMessages({ messages, keepCount: 3, summary: "Compacted summary here" });
    const first = result.messages[0];
    expect(first?.role).toBe("system");
    expect((first as { content: string }).content).toContain("Compacted summary here");
  });

  test("summary message includes dropped count", () => {
    const messages = makeMessages(10);
    const result = compactMessages({ messages, keepCount: 4, summary: "summary" });
    const first = result.messages[0];
    expect((first as { content: string }).content).toContain("6");
  });

  test("keepCount = 1: summary + last message remain", () => {
    const messages = makeMessages(5);
    const result = compactMessages({ messages, keepCount: 1, summary: "summary" });
    expect(result.dropped).toBe(4);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.role).toBe("system");
    expect((result.messages[1] as { content: string }).content).toBe("Message 5");
  });

  test("empty messages: no compaction", () => {
    const result = compactMessages({ messages: [], keepCount: 5, summary: "summary" });
    expect(result.dropped).toBe(0);
    expect(result.messages).toHaveLength(0);
  });
});
