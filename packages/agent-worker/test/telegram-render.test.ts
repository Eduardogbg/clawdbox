import { describe, expect, it } from "bun:test";
import { truncateForTelegram, withResumeLine } from "../src/telegram-render.js";

describe("telegram-render", () => {
  it("adds resume line when session id exists", () => {
    const text = withResumeLine("hello", "session-123");
    expect(text.includes("resume: session-123")).toBe(true);
  });

  it("preserves resume line when truncating", () => {
    const base = "x".repeat(5000);
    const text = `${base}\nresume: session-xyz`;
    const truncated = truncateForTelegram(text, 200);
    expect(truncated.length).toBeLessThanOrEqual(200);
    expect(truncated.includes("resume: session-xyz")).toBe(true);
  });
});
