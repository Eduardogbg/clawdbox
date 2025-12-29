/**
 * Telegram Client Tests
 *
 * Tests for the Telegram Bot API client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import { createTelegramClient } from "../src/telegram.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

describe("Telegram Client", () => {
  const client = createTelegramClient("test-bot-token");

  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe("sendMessage", () => {
    it("should send a message successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { message_id: 123 } }),
      });

      const result = await Effect.runPromise(
        client.sendMessage({
          chat_id: 12345,
          text: "Hello, world!",
        })
      );

      expect(result.result.message_id).toBe(123);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-bot-token/sendMessage",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ chat_id: 12345, text: "Hello, world!" }),
        })
      );
    });

    it("should send a message with parse_mode", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { message_id: 124 } }),
      });

      await Effect.runPromise(
        client.sendMessage({
          chat_id: 12345,
          text: "<b>Bold</b>",
          parse_mode: "HTML",
        })
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            chat_id: 12345,
            text: "<b>Bold</b>",
            parse_mode: "HTML",
          }),
        })
      );
    });

    it("should fail on Telegram API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => "Bad Request: chat not found",
      });

      await expect(
        Effect.runPromise(
          client.sendMessage({ chat_id: 12345, text: "Hello" })
        )
      ).rejects.toThrow("Telegram API error: Bad Request: chat not found");
    });
  });

  describe("answerCallbackQuery", () => {
    it("should answer a callback query", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });

      const result = await Effect.runPromise(
        client.answerCallbackQuery("query123", { text: "Done!" })
      );

      expect(result.result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-bot-token/answerCallbackQuery",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            callback_query_id: "query123",
            text: "Done!",
          }),
        })
      );
    });

    it("should answer with alert", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });

      await Effect.runPromise(
        client.answerCallbackQuery("query123", {
          text: "Important!",
          show_alert: true,
        })
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            callback_query_id: "query123",
            text: "Important!",
            show_alert: true,
          }),
        })
      );
    });
  });

  describe("createForumTopic", () => {
    it("should create a forum topic", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            message_thread_id: 42,
            name: "Task: Fix bug",
            icon_color: 0x6fb9f0,
          },
        }),
      });

      const result = await Effect.runPromise(
        client.createForumTopic({
          chat_id: -123456789,
          name: "Task: Fix bug",
        })
      );

      expect(result.message_thread_id).toBe(42);
      expect(result.name).toBe("Task: Fix bug");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-bot-token/createForumTopic",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            chat_id: -123456789,
            name: "Task: Fix bug",
          }),
        })
      );
    });
  });

  describe("editMessageText", () => {
    it("should edit a message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { message_id: 123 } }),
      });

      const result = await Effect.runPromise(
        client.editMessageText(12345, 123, "Updated text")
      );

      expect(result.result.message_id).toBe(123);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-bot-token/editMessageText",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            chat_id: 12345,
            message_id: 123,
            text: "Updated text",
          }),
        })
      );
    });

    it("should edit with parse_mode and reply_markup", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { message_id: 123 } }),
      });

      await Effect.runPromise(
        client.editMessageText(12345, 123, "<b>Bold</b>", {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "Button", callback_data: "click" }]],
          },
        })
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            chat_id: 12345,
            message_id: 123,
            text: "<b>Bold</b>",
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "Button", callback_data: "click" }]],
            },
          }),
        })
      );
    });
  });

  describe("deleteMessage", () => {
    it("should delete a message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });

      const result = await Effect.runPromise(
        client.deleteMessage(12345, 123)
      );

      expect(result.result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-bot-token/deleteMessage",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            chat_id: 12345,
            message_id: 123,
          }),
        })
      );
    });
  });

  describe("setWebhook", () => {
    it("should set webhook URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });

      const result = await Effect.runPromise(
        client.setWebhook("https://example.com/webhook")
      );

      expect(result.result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-bot-token/setWebhook",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ url: "https://example.com/webhook" }),
        })
      );
    });

    it("should set webhook with secret token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: true }),
      });

      await Effect.runPromise(
        client.setWebhook("https://example.com/webhook", {
          secret_token: "secret123",
        })
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            url: "https://example.com/webhook",
            secret_token: "secret123",
          }),
        })
      );
    });
  });

  describe("getWebhookInfo", () => {
    it("should get webhook info", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            url: "https://example.com/webhook",
            has_custom_certificate: false,
            pending_update_count: 0,
          },
        }),
      });

      const result = await Effect.runPromise(client.getWebhookInfo());

      expect(result.result.url).toBe("https://example.com/webhook");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-bot-token/getWebhookInfo"
      );
    });
  });
});
