import { describe, expect, it } from "bun:test";
import { ExecProgressRenderer } from "../src/codex-progress.js";

describe("ExecProgressRenderer", () => {
  it("renders progress header", () => {
    const renderer = new ExecProgressRenderer();
    renderer.noteEvent({ type: "turn.started" });
    const text = renderer.renderProgress(2);
    expect(text.startsWith("working - ")).toBe(true);
  });

  it("renders command execution events", () => {
    const renderer = new ExecProgressRenderer();
    renderer.noteEvent({
      type: "item.started",
      item: { id: "item_1", type: "command_execution", command: "ls -la" },
    });
    const progress = renderer.renderProgress(1);
    expect(progress.includes("running:")).toBe(true);

    renderer.noteEvent({
      type: "item.completed",
      item: { id: "item_1", type: "command_execution", command: "ls -la", exit_code: 0 },
    });
    const final = renderer.renderFinal(2, "done");
    expect(final.includes("ran:")).toBe(true);
  });
});
