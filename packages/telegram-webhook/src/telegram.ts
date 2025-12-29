/**
 * Telegram Bot API Client
 *
 * Simple client for sending messages to Telegram.
 */
import * as Effect from "effect/Effect";
import type {
  CreateForumTopicParams,
  ForumTopic,
  InlineKeyboardMarkup,
  SendMessageParams,
} from "./types.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";

/**
 * Telegram API client
 */
export const createTelegramClient = (botToken: string) => {
  const apiUrl = `${TELEGRAM_API_BASE}/bot${botToken}`;

  /**
   * Send a message
   */
  const sendMessage = (params: SendMessageParams) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${apiUrl}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Telegram API error: ${error}`);
        }

        return response.json();
      },
      catch: (error) => new Error(`Failed to send message: ${error}`),
    });

  /**
   * Answer a callback query (button press)
   */
  const answerCallbackQuery = (
    callbackQueryId: string,
    options?: { text?: string; show_alert?: boolean },
  ) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${apiUrl}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: callbackQueryId,
            ...options,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Telegram API error: ${error}`);
        }

        return response.json();
      },
      catch: (error) => new Error(`Failed to answer callback query: ${error}`),
    });

  /**
   * Create a forum topic (thread)
   */
  const createForumTopic = (params: CreateForumTopicParams) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${apiUrl}/createForumTopic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Telegram API error: ${error}`);
        }

        const result = (await response.json()) as { result: ForumTopic };
        return result.result;
      },
      catch: (error) => new Error(`Failed to create forum topic: ${error}`),
    });

  /**
   * Edit a message
   */
  const editMessageText = (
    chatId: number | string,
    messageId: number,
    text: string,
    options?: {
      parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
      reply_markup?: InlineKeyboardMarkup;
    },
  ) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${apiUrl}/editMessageText`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text,
            ...options,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Telegram API error: ${error}`);
        }

        return response.json();
      },
      catch: (error) => new Error(`Failed to edit message: ${error}`),
    });

  /**
   * Delete a message
   */
  const deleteMessage = (chatId: number | string, messageId: number) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${apiUrl}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Telegram API error: ${error}`);
        }

        return response.json();
      },
      catch: (error) => new Error(`Failed to delete message: ${error}`),
    });

  /**
   * Set webhook URL
   */
  const setWebhook = (url: string, options?: { secret_token?: string }) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${apiUrl}/setWebhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, ...options }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Telegram API error: ${error}`);
        }

        return response.json();
      },
      catch: (error) => new Error(`Failed to set webhook: ${error}`),
    });

  /**
   * Get webhook info
   */
  const getWebhookInfo = () =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${apiUrl}/getWebhookInfo`);

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Telegram API error: ${error}`);
        }

        return response.json();
      },
      catch: (error) => new Error(`Failed to get webhook info: ${error}`),
    });

  return {
    sendMessage,
    answerCallbackQuery,
    createForumTopic,
    editMessageText,
    deleteMessage,
    setWebhook,
    getWebhookInfo,
  };
};

export type TelegramClient = ReturnType<typeof createTelegramClient>;
