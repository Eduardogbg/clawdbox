/**
 * Telegram Bot API helpers (types, schema, client).
 */
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as S from "effect/Schema";

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type?: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface SendMessageParams {
  chat_id: number | string;
  text: string;
  reply_to_message_id?: number;
  allow_sending_without_reply?: boolean;
  disable_notification?: boolean;
}

export interface EditMessageParams {
  chat_id: number | string;
  message_id: number;
  text: string;
}

export interface TelegramMessageResult {
  message_id: number;
}

const TelegramUserSchema = S.Struct({
  id: S.Number,
  is_bot: S.optional(S.Boolean),
  first_name: S.optional(S.String),
  last_name: S.optional(S.String),
  username: S.optional(S.String),
});

const TelegramChatSchema = S.Struct({
  id: S.Number,
  type: S.optional(S.Literal("private", "group", "supergroup", "channel")),
  title: S.optional(S.String),
  username: S.optional(S.String),
  first_name: S.optional(S.String),
  last_name: S.optional(S.String),
});

const TelegramMessageSchema: S.Schema<TelegramMessage> = S.Struct({
  message_id: S.Number,
  text: S.optional(S.String),
  chat: TelegramChatSchema,
  from: S.optional(TelegramUserSchema),
  reply_to_message: S.optional(S.suspend(() => TelegramMessageSchema)),
});

const TelegramUpdateSchema: S.Schema<TelegramUpdate> = S.Struct({
  update_id: S.Number,
  message: S.optional(TelegramMessageSchema),
});

export const decodeTelegramUpdate = (input: unknown) =>
  pipe(
    Effect.succeed(input),
    Effect.flatMap(S.decodeUnknown(TelegramUpdateSchema)),
    Effect.mapError((error) => new Error(`Invalid Telegram update: ${error}`)),
  );

export const getTelegramChatId = (update: TelegramUpdate): number | null => {
  const chatId = update.message?.chat?.id;
  return typeof chatId === "number" ? chatId : null;
};

const TELEGRAM_API_BASE = "https://api.telegram.org";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseApiResult = <A>(payload: unknown): A => {
  if (!isRecord(payload)) {
    throw new Error("Invalid Telegram response payload");
  }
  if (payload.ok !== true) {
    throw new Error(`Telegram API error: ${JSON.stringify(payload)}`);
  }
  return payload.result as A;
};

export interface TelegramClient {
  sendMessage: (params: SendMessageParams) => Effect.Effect<TelegramMessageResult, Error>;
  editMessageText: (params: EditMessageParams) => Effect.Effect<TelegramMessageResult, Error>;
  deleteMessage: (chatId: number | string, messageId: number) => Effect.Effect<void, Error>;
  setWebhook: (url: string, secretToken?: string) => Effect.Effect<void, Error>;
}

export const createTelegramClient = (botToken: string): TelegramClient => {
  const apiUrl = `${TELEGRAM_API_BASE}/bot${botToken}`;

  const postJson = <A>(method: string, body: unknown) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${apiUrl}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Telegram API error: ${error}`);
        }
        const payload = (await response.json()) as unknown;
        return parseApiResult<A>(payload);
      },
      catch: (error) => new Error(`Telegram request failed: ${error}`),
    });

  const sendMessage = (params: SendMessageParams) => postJson<TelegramMessageResult>("sendMessage", params);

  const editMessageText = (params: EditMessageParams) =>
    postJson<TelegramMessageResult>("editMessageText", params);

  const deleteMessage = (chatId: number | string, messageId: number) =>
    pipe(postJson("deleteMessage", { chat_id: chatId, message_id: messageId }), Effect.asVoid);

  const setWebhook = (url: string, secretToken?: string) =>
    pipe(
      postJson("setWebhook", {
        url,
        ...(secretToken ? { secret_token: secretToken } : {}),
      }),
      Effect.asVoid,
    );

  return { sendMessage, editMessageText, deleteMessage, setWebhook };
};
