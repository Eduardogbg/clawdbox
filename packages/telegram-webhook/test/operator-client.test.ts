/**
 * Operator Client Tests
 *
 * Tests for the Operator Durable Object client.
 */
import { describe, it, expect, vi, beforeEach } from "bun:test";
import * as Effect from "effect/Effect";
import { createOperatorClient, type TaskResponse, type PermissionResponse } from "../src/operator-client.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe("Operator Client", () => {
  const client = createOperatorClient("https://operator.example.com");

  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe("createTask", () => {
    it("should create a task successfully", async () => {
      const taskResponse: TaskResponse = {
        id: "task-123",
        prompt: "Fix the bug",
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => taskResponse,
      });

      const result = await Effect.runPromise(
        client.createTask({ prompt: "Fix the bug", telegramChatId: 12345 })
      );

      expect(result.id).toBe("task-123");
      expect(result.prompt).toBe("Fix the bug");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://operator.example.com/tasks",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ prompt: "Fix the bug", telegramChatId: 12345 }),
        })
      );
    });

    it("should fail on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad request",
      });

      await expect(
        Effect.runPromise(client.createTask({ prompt: "Fix the bug" }))
      ).rejects.toThrow("Failed to create task: 400 Bad request");
    });
  });

  describe("getTask", () => {
    it("should get a task successfully", async () => {
      const taskResponse: TaskResponse = {
        id: "task-123",
        prompt: "Fix the bug",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => taskResponse,
      });

      const result = await Effect.runPromise(client.getTask("task-123"));

      expect(result.id).toBe("task-123");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://operator.example.com/tasks/task-123"
      );
    });

    it("should fail on not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(
        Effect.runPromise(client.getTask("nonexistent"))
      ).rejects.toThrow("Failed to get task: 404");
    });
  });

  describe("listTasks", () => {
    it("should list all tasks", async () => {
      const tasksResponse = {
        tasks: [
          { id: "task-1", prompt: "Task 1", status: "pending", createdAt: Date.now(), updatedAt: Date.now() },
          { id: "task-2", prompt: "Task 2", status: "active", createdAt: Date.now(), updatedAt: Date.now() },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => tasksResponse,
      });

      const result = await Effect.runPromise(client.listTasks());

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("task-1");
      expect(result[1].id).toBe("task-2");
    });

    it("should filter by status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tasks: [] }),
      });

      await Effect.runPromise(client.listTasks({ status: "active", limit: 5 }));

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("status=active")
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=5")
      );
    });
  });

  describe("resolvePermission", () => {
    it("should approve a permission", async () => {
      const permissionResponse: PermissionResponse = {
        id: "perm-123",
        sessionId: "session-1",
        toolName: "Write",
        toolInput: '{"path": "/test.txt"}',
        status: "approved",
        createdAt: Date.now(),
        resolvedAt: Date.now(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => permissionResponse,
      });

      const result = await Effect.runPromise(
        client.resolvePermission("perm-123", { approved: true })
      );

      expect(result.status).toBe("approved");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://operator.example.com/permissions/perm-123/resolve",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ approved: true }),
        })
      );
    });

    it("should deny a permission with reason", async () => {
      const permissionResponse: PermissionResponse = {
        id: "perm-123",
        sessionId: "session-1",
        toolName: "Bash",
        toolInput: '{"command": "rm -rf /"}',
        status: "denied",
        reason: "Too dangerous",
        createdAt: Date.now(),
        resolvedAt: Date.now(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => permissionResponse,
      });

      const result = await Effect.runPromise(
        client.resolvePermission("perm-123", { approved: false, reason: "Too dangerous" })
      );

      expect(result.status).toBe("denied");
      expect(result.reason).toBe("Too dangerous");
    });
  });

  describe("getTaskPermissions", () => {
    it("should get pending permissions for a task", async () => {
      const response = {
        permissions: [
          {
            id: "perm-1",
            sessionId: "session-1",
            toolName: "Write",
            toolInput: '{"path": "/test.txt"}',
            status: "pending",
            createdAt: Date.now(),
          },
        ],
        taskId: "task-123",
        sessionId: "session-1",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => response,
      });

      const result = await Effect.runPromise(client.getTaskPermissions("task-123"));

      expect(result.permissions).toHaveLength(1);
      expect(result.taskId).toBe("task-123");
      expect(result.sessionId).toBe("session-1");
    });
  });

  describe("updateTaskStatus", () => {
    it("should update task status", async () => {
      const taskResponse: TaskResponse = {
        id: "task-123",
        prompt: "Fix the bug",
        status: "completed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => taskResponse,
      });

      const result = await Effect.runPromise(
        client.updateTaskStatus("task-123", "completed")
      );

      expect(result.status).toBe("completed");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://operator.example.com/tasks/task-123/status",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "completed" }),
        })
      );
    });
  });

  describe("sendStreamMessage", () => {
    it("should send a stream message", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await Effect.runPromise(
        client.sendStreamMessage({
          taskId: "task-123",
          text: "Working on it...",
          type: "text",
        })
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://operator.example.com/stream",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            taskId: "task-123",
            text: "Working on it...",
            type: "text",
          }),
        })
      );
    });
  });
});
