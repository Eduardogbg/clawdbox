/**
 * Permission Hook Tests
 *
 * Tests for the permission hook logic without hitting real APIs.
 */
import { describe, it, expect, vi, beforeEach } from "bun:test";
import * as Effect from "effect/Effect";
import type { AgentConfig } from "../src/config.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

// Import after mocking
const { createPermissionHook, streamToOperator, reportSessionId, reportCompletion, reportError } =
  await import("../src/permission.js");

const baseConfig: AgentConfig = {
  taskId: "test-task-123",
  prompt: "Fix the bug",
  repoUrl: "https://github.com/test/repo.git",
  branch: "main",
  operatorUrl: "https://operator.example.com",
};

describe("Permission Hook", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe("Auto-allow rules", () => {
    it("should auto-allow Read tool", async () => {
      const hook = createPermissionHook(baseConfig);

      const result = await hook(
        { tool_name: "Read", tool_input: { path: "/file.txt" } },
        "tool-use-1",
        {}
      );

      expect(result).toEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should auto-allow Glob tool", async () => {
      const hook = createPermissionHook(baseConfig);

      const result = await hook(
        { tool_name: "Glob", tool_input: { pattern: "*.ts" } },
        "tool-use-2",
        {}
      );

      expect(result).toEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should auto-allow Grep tool", async () => {
      const hook = createPermissionHook(baseConfig);

      const result = await hook(
        { tool_name: "Grep", tool_input: { pattern: "function" } },
        "tool-use-3",
        {}
      );

      expect(result).toEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should auto-allow WebSearch tool", async () => {
      const hook = createPermissionHook(baseConfig);

      const result = await hook(
        { tool_name: "WebSearch", tool_input: { query: "how to test" } },
        "tool-use-4",
        {}
      );

      expect(result).toEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should auto-allow safe bash commands", async () => {
      const hook = createPermissionHook(baseConfig);

      // ls command
      let result = await hook(
        { tool_name: "Bash", tool_input: { command: "ls -la" } },
        "tool-use-5",
        {}
      );
      expect(result).toEqual({});

      // git status
      result = await hook(
        { tool_name: "Bash", tool_input: { command: "git status" } },
        "tool-use-6",
        {}
      );
      expect(result).toEqual({});

      // git log
      result = await hook(
        { tool_name: "Bash", tool_input: { command: "git log --oneline -5" } },
        "tool-use-7",
        {}
      );
      expect(result).toEqual({});

      // bun run typecheck
      result = await hook(
        { tool_name: "Bash", tool_input: { command: "bun run typecheck" } },
        "tool-use-8",
        {}
      );
      expect(result).toEqual({});

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Permission-required tools", () => {
    it("should request permission for Write tool", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ approved: true }),
      });

      const hook = createPermissionHook(baseConfig);

      const result = await hook(
        { tool_name: "Write", tool_input: { path: "/file.txt", content: "test" } },
        "tool-use-9",
        {}
      );

      expect(result).toEqual({});
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://operator.example.com/permission",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("should request permission for Edit tool", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ approved: true }),
      });

      const hook = createPermissionHook(baseConfig);

      const result = await hook(
        { tool_name: "Edit", tool_input: { path: "/file.txt", changes: "patch" } },
        "tool-use-10",
        {}
      );

      expect(result).toEqual({});
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should request permission for dangerous bash commands", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ approved: true }),
      });

      const hook = createPermissionHook(baseConfig);

      const result = await hook(
        { tool_name: "Bash", tool_input: { command: "rm -rf /tmp/test" } },
        "tool-use-11",
        {}
      );

      expect(result).toEqual({});
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should block when permission is denied", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ approved: false, reason: "User denied" }),
      });

      const hook = createPermissionHook(baseConfig);

      const result = await hook(
        { tool_name: "Write", tool_input: { path: "/file.txt", content: "test" } },
        "tool-use-12",
        {}
      );

      expect(result).toEqual({
        decision: "block",
        reason: "User denied",
      });
    });

    it("should block on API failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const hook = createPermissionHook(baseConfig);

      const result = await hook(
        { tool_name: "Write", tool_input: { path: "/file.txt", content: "test" } },
        "tool-use-13",
        {}
      );

      expect(result).toEqual({
        decision: "block",
        reason: "Failed to request permission: 500",
      });
    });
  });
});

describe("Operator Communication", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("should report session ID", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await Effect.runPromise(
      reportSessionId("https://operator.example.com", "task-123", "session-abc")
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://operator.example.com/session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", sessionId: "session-abc" }),
      })
    );
  });

  it("should stream messages to operator", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const message = {
      type: "tool_use",
      name: "Write",
    };

    await Effect.runPromise(
      streamToOperator("https://operator.example.com", "task-123", message)
    );

    expect(mockFetch).toHaveBeenCalled();
  });

  it("should report completion", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await Effect.runPromise(
      reportCompletion("https://operator.example.com", "task-123", { success: true })
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://operator.example.com/complete",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("should report errors", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await Effect.runPromise(
      reportError("https://operator.example.com", "task-123", "Something went wrong")
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://operator.example.com/error",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ taskId: "task-123", error: "Something went wrong" }),
      })
    );
  });
});
