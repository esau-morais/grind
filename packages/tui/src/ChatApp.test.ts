import { describe, expect, test } from "bun:test";

import { formatToolResult } from "./ChatApp";

describe("formatToolResult companion/chat outputs", () => {
  test("summarizes list_insights result counts", () => {
    expect(formatToolResult("list_insights", [])).toBe("0 insights listed");
    expect(formatToolResult("list_insights", [{ id: "1" }])).toBe("1 insight listed");
  });

  test("summarizes store_insight for create vs dedupe update", () => {
    expect(formatToolResult("store_insight", { created: true, category: "goal" })).toBe(
      "stored insight (goal)",
    );
    expect(formatToolResult("store_insight", { created: false, category: "pattern" })).toBe(
      "updated insight (pattern)",
    );
  });

  test("returns error text directly when tool result has error", () => {
    expect(formatToolResult("store_insight", { error: "Insight content cannot be empty" })).toBe(
      "Insight content cannot be empty",
    );
  });
});
