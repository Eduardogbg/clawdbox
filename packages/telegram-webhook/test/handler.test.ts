/**
 * Telegram Handler Tests
 *
 * Tests for the Telegram update handler without hitting real APIs.
 */
import { describe, it, expect, vi } from "vitest";
import * as Effect from "effect/Effect";
import type { Message, Update } from "../src/types.js";

// Mock implementations
const createMockTelegram = () => {
  const sentMessages: Array<{ chat_id: number; text: string }> = [];
  const answeredQueries: Array<{ id: string; text: string }> = [];
  const createdTopics: Array<{ chat_id: number; name: string }> = [];

  return {
    sentMessages,
    answeredQueries,
    createdTopics,
    sendMessage: (params: { chat_id: number; text: string; [k: string]: unknown }) =>
      Effect.sync(() => {
        sentMessages.push({ chat_id: params.chat_id, text: params.text });
        return { message_id: 123 };
      }),
    answerCallbackQuery: (id: string, options: { text: string }) =>
      Effect.sync(() => {
        answeredQueries.push({ id, text: options.text });
        return true;
      }),
    createForumTopic: (params: { chat_id: number; name: string }) =>
      Effect.sync(() => {
        createdTopics.push({ chat_id: params.chat_id, name: params.name });
        return { message_thread_id: 42 };
      }),
    editMessageText: (_chatId: number, _messageId: number, _text: string) =>
      Effect.sync(() => true),
    getWebhookInfo: () =>
      Effect.sync(() => ({ url: "https://example.com/webhook" })),
    setWebhook: (_url: string, _options?: unknown) =>
      Effect.sync(() => ({ ok: true })),
    deleteMessage: (_chatId: number, _messageId: number) =>
      Effect.sync(() => true),
  };
};

const createMockOperator = () => {
  const createdTasks: Array<{ prompt: string }> = [];
  const resolvedPermissions: Array<{ id: string; approved: boolean }> = [];

  return {
    createdTasks,
    resolvedPermissions,
    createTask: (params: { prompt: string; telegramChatId?: number; telegramTopicId?: number }) =>
      Effect.sync(() => {
        createdTasks.push({ prompt: params.prompt });
        return { id: "test-task-id", prompt: params.prompt, status: "pending" };
      }),
    listTasks: (_params?: { status?: string; limit?: number }) =>
      Effect.sync(() => [] as Array<{ id: string; prompt: string; status: string }>),
    resolvePermission: (id: string, params: { approved: boolean }) =>
      Effect.sync(() => {
        resolvedPermissions.push({ id, approved: params.approved });
        return { id, status: params.approved ? "approved" : "denied" };
      }),
    updateTaskStatus: (_taskId: string, _status: string) =>
      Effect.sync(() => ({ id: _taskId, status: _status })),
  };
};

describe("Telegram Handler", () => {
  describe("Command Parsing", () => {
    it("should parse /start command", async () => {
      const telegram = createMockTelegram();
      const operator = createMockOperator();

      const message: Message = {
        message_id: 1,
        date: Date.now(),
        chat: { id: 12345, type: "private" },
        from: { id: 1, is_bot: false, first_name: "Test" },
        text: "/start",
      };

      // Import handler dynamically to use fresh mocks
      const { handleUpdate } = await import("../src/handler.js");

      await Effect.runPromise(
        handleUpdate(
          { update_id: 1, message },
          { telegram: telegram as never, operator: operator as never, operatorUrl: "http://test" }
        )
      );

      expect(telegram.sentMessages.length).toBe(1);
      expect(telegram.sentMessages[0].text).toContain("Welcome to Clawdbox");
    });

    it("should parse /task command with description", async () => {
      const telegram = createMockTelegram();
      const operator = createMockOperator();

      const message: Message = {
        message_id: 1,
        date: Date.now(),
        chat: { id: 12345, type: "private" },
        from: { id: 1, is_bot: false, first_name: "Test" },
        text: "/task Fix the login bug",
      };

      const { handleUpdate } = await import("../src/handler.js");

      await Effect.runPromise(
        handleUpdate(
          { update_id: 1, message },
          { telegram: telegram as never, operator: operator as never, operatorUrl: "http://test" }
        )
      );

      expect(operator.createdTasks.length).toBe(1);
      expect(operator.createdTasks[0].prompt).toBe("Fix the login bug");
    });

    it("should handle /task without description", async () => {
      const telegram = createMockTelegram();
      const operator = createMockOperator();

      const message: Message = {
        message_id: 1,
        date: Date.now(),
        chat: { id: 12345, type: "private" },
        from: { id: 1, is_bot: false, first_name: "Test" },
        text: "/task",
      };

      const { handleUpdate } = await import("../src/handler.js");

      await Effect.runPromise(
        handleUpdate(
          { update_id: 1, message },
          { telegram: telegram as never, operator: operator as never, operatorUrl: "http://test" }
        )
      );

      expect(operator.createdTasks.length).toBe(0);
      expect(telegram.sentMessages.length).toBe(1);
      expect(telegram.sentMessages[0].text).toContain("Please provide a task description");
    });

    it("should handle /help command", async () => {
      const telegram = createMockTelegram();
      const operator = createMockOperator();

      const message: Message = {
        message_id: 1,
        date: Date.now(),
        chat: { id: 12345, type: "private" },
        from: { id: 1, is_bot: false, first_name: "Test" },
        text: "/help",
      };

      const { handleUpdate } = await import("../src/handler.js");

      await Effect.runPromise(
        handleUpdate(
          { update_id: 1, message },
          { telegram: telegram as never, operator: operator as never, operatorUrl: "http://test" }
        )
      );

      expect(telegram.sentMessages.length).toBe(1);
      expect(telegram.sentMessages[0].text).toContain("Available commands");
    });

    it("should handle unknown commands", async () => {
      const telegram = createMockTelegram();
      const operator = createMockOperator();

      const message: Message = {
        message_id: 1,
        date: Date.now(),
        chat: { id: 12345, type: "private" },
        from: { id: 1, is_bot: false, first_name: "Test" },
        text: "/unknown_command",
      };

      const { handleUpdate } = await import("../src/handler.js");

      await Effect.runPromise(
        handleUpdate(
          { update_id: 1, message },
          { telegram: telegram as never, operator: operator as never, operatorUrl: "http://test" }
        )
      );

      expect(telegram.sentMessages.length).toBe(1);
      expect(telegram.sentMessages[0].text).toContain("Unknown command");
    });
  });

  describe("Forum Topics", () => {
    it("should create forum topic for supergroup chats", async () => {
      const telegram = createMockTelegram();
      const operator = createMockOperator();

      const message: Message = {
        message_id: 1,
        date: Date.now(),
        chat: { id: -123456789, type: "supergroup" },
        from: { id: 1, is_bot: false, first_name: "Test" },
        text: "/task Create a new feature",
      };

      const { handleUpdate } = await import("../src/handler.js");

      await Effect.runPromise(
        handleUpdate(
          { update_id: 1, message },
          { telegram: telegram as never, operator: operator as never, operatorUrl: "http://test" }
        )
      );

      expect(telegram.createdTopics.length).toBe(1);
      expect(telegram.createdTopics[0].name).toContain("Create a new feature");
    });
  });

  describe("Callback Queries", () => {
    it("should handle permission approval", async () => {
      const telegram = createMockTelegram();
      const operator = createMockOperator();

      const update: Update = {
        update_id: 1,
        callback_query: {
          id: "query123",
          from: { id: 1, is_bot: false, first_name: "Test" },
          chat_instance: "test",
          data: "approve:permission-id-123",
          message: {
            message_id: 1,
            date: Date.now(),
            chat: { id: 12345, type: "private" },
            text: "Approve this action?",
          },
        },
      };

      const { handleUpdate } = await import("../src/handler.js");

      await Effect.runPromise(
        handleUpdate(
          update,
          { telegram: telegram as never, operator: operator as never, operatorUrl: "http://test" }
        )
      );

      expect(operator.resolvedPermissions.length).toBe(1);
      expect(operator.resolvedPermissions[0].approved).toBe(true);
      expect(telegram.answeredQueries.length).toBe(1);
      expect(telegram.answeredQueries[0].text).toContain("Approved");
    });

    it("should handle permission denial", async () => {
      const telegram = createMockTelegram();
      const operator = createMockOperator();

      const update: Update = {
        update_id: 1,
        callback_query: {
          id: "query123",
          from: { id: 1, is_bot: false, first_name: "Test" },
          chat_instance: "test",
          data: "deny:permission-id-123",
          message: {
            message_id: 1,
            date: Date.now(),
            chat: { id: 12345, type: "private" },
            text: "Deny this action?",
          },
        },
      };

      const { handleUpdate } = await import("../src/handler.js");

      await Effect.runPromise(
        handleUpdate(
          update,
          { telegram: telegram as never, operator: operator as never, operatorUrl: "http://test" }
        )
      );

      expect(operator.resolvedPermissions.length).toBe(1);
      expect(operator.resolvedPermissions[0].approved).toBe(false);
      expect(telegram.answeredQueries.length).toBe(1);
      expect(telegram.answeredQueries[0].text).toContain("Denied");
    });
  });

  describe("Non-command Messages", () => {
    it("should prompt user in private chat for non-command", async () => {
      const telegram = createMockTelegram();
      const operator = createMockOperator();

      const message: Message = {
        message_id: 1,
        date: Date.now(),
        chat: { id: 12345, type: "private" },
        from: { id: 1, is_bot: false, first_name: "Test" },
        text: "Hello bot!",
      };

      const { handleUpdate } = await import("../src/handler.js");

      await Effect.runPromise(
        handleUpdate(
          { update_id: 1, message },
          { telegram: telegram as never, operator: operator as never, operatorUrl: "http://test" }
        )
      );

      expect(telegram.sentMessages.length).toBe(1);
      expect(telegram.sentMessages[0].text).toContain("/task");
    });

    it("should forward message in topic to agent", async () => {
      const telegram = createMockTelegram();
      const operator = createMockOperator();

      const message: Message = {
        message_id: 1,
        date: Date.now(),
        chat: { id: -123456789, type: "supergroup" },
        from: { id: 1, is_bot: false, first_name: "Test" },
        text: "Here is some additional context",
        message_thread_id: 42,
      };

      const { handleUpdate } = await import("../src/handler.js");

      await Effect.runPromise(
        handleUpdate(
          { update_id: 1, message },
          { telegram: telegram as never, operator: operator as never, operatorUrl: "http://test" }
        )
      );

      expect(telegram.sentMessages.length).toBe(1);
      expect(telegram.sentMessages[0].text).toContain("Message received");
    });
  });
});
