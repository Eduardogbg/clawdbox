/**
 * Manager Durable Object for settings and credentials.
 */
import { DurableObject } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as S from "effect/Schema";

import type { TelegramMessage } from "./telegram.js";
import { createTelegramClient, decodeTelegramUpdate } from "./telegram.js";
import type { Env } from "./types.js";

const SQL = {
  INIT: `
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      settings_thread_id INTEGER,
      updated_at INTEGER
    );
    INSERT OR IGNORE INTO settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      cloudflare_account_id TEXT NOT NULL,
      cloudflare_api_token TEXT NOT NULL,
      codex_api_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      stage TEXT,
      cloudflare_account_id TEXT,
      cloudflare_api_token TEXT,
      codex_api_key TEXT,
      updated_at INTEGER
    );
    INSERT OR IGNORE INTO auth_state (id) VALUES (1);
  `,
  GET_SETTINGS: `
    SELECT settings_thread_id, updated_at
    FROM settings
    WHERE id = 1
  `,
  UPDATE_SETTINGS: `
    UPDATE settings
    SET settings_thread_id = ?, updated_at = ?
    WHERE id = 1
  `,
  UPSERT_CREDENTIALS: `
    INSERT INTO credentials (chat_id, cloudflare_account_id, cloudflare_api_token, codex_api_key, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,
  GET_AUTH: `
    SELECT stage, cloudflare_account_id, cloudflare_api_token, codex_api_key, updated_at
    FROM auth_state
    WHERE id = 1
  `,
  UPDATE_AUTH: `
    UPDATE auth_state
    SET stage = ?, cloudflare_account_id = ?, cloudflare_api_token = ?, codex_api_key = ?, updated_at = ?
    WHERE id = 1
  `,
};

const RegisterSchema = S.Struct({
  chat_id: S.Number,
  cloudflare_account_id: S.String,
  cloudflare_api_token: S.String,
  codex_api_key: S.String,
});

type RegisterInput = S.Schema.Type<typeof RegisterSchema>;

const jsonHeaders = { "Content-Type": "application/json" };

type AuthStage = "cloudflare_account_id" | "cloudflare_api_token" | "codex_api_key";

type AuthState = {
  stage: AuthStage | null;
  cloudflareAccountId: string | null;
  cloudflareApiToken: string | null;
  codexApiKey: string | null;
  updatedAt: number | null;
};

const isAuthorized = (request: Request, token: string | undefined): boolean => {
  if (!token) return false;
  const header = request.headers.get("Authorization");
  if (!header) return false;
  const [, value] = header.split(" ");
  return value === token;
};

export class ManagerDO extends DurableObject<Env> {
  private initialized = false;
  private chatId: number | null = null;

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(SQL.INIT);
    this.initialized = true;
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureInitialized();
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/debug") {
      return this.handleDebug();
    }
    if (request.method === "POST" && url.pathname === "/handle") {
      return this.handleTelegram(request);
    }
    if (request.method === "POST" && url.pathname === "/cli/register") {
      return this.handleRegister(request);
    }
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  private handleDebug(): Response {
    const row = this.ctx.storage.sql.exec(SQL.GET_SETTINGS).one();
    return new Response(
      JSON.stringify({
        chatId: this.chatId,
        settingsThreadId: row?.settings_thread_id ?? null,
        updatedAt: row?.updated_at ?? null,
        authStage: this.getAuthState().stage,
      }),
      { headers: jsonHeaders },
    );
  }

  private async handleTelegram(request: Request): Promise<Response> {
    const update = await pipe(
      decodeTelegramUpdate(await request.json()),
      Effect.runPromise,
    );
    const message = update.message;
    if (!message?.text) {
      return new Response(JSON.stringify({ handled: false }), { headers: jsonHeaders });
    }
    this.chatId = message.chat.id;
    const text = message.text.trim();
    const parsed = this.parseCommand(text);
    let settingsThreadId = this.getSettingsThreadId();
    const isPrivate = message.chat.type === "private";

    if (parsed?.command === "settings") {
      return this.handleSettingsCommand(message.message_id, message.message_thread_id ?? null);
    }

    if (parsed?.command === "auth") {
      return this.handleAuthCommand(message, settingsThreadId, isPrivate);
    }

    const authState = this.getAuthState();
    const inSettingsThread =
      settingsThreadId !== null && message.message_thread_id === settingsThreadId;
    if (authState.stage && (isPrivate || inSettingsThread)) {
      await this.handleAuthInput(
        message.message_id,
        message.message_thread_id ?? null,
        text,
        authState,
      );
      return new Response(JSON.stringify({ handled: true }), { headers: jsonHeaders });
    }

    if (!settingsThreadId || message.message_thread_id !== settingsThreadId) {
      return new Response(JSON.stringify({ handled: false }), { headers: jsonHeaders });
    }

    if (parsed?.command === "help") {
      await this.sendTelegramMessage(message.message_id, settingsThreadId, [
        "settings commands:",
        "/settings (set this topic as canonical)",
        "/auth (store Cloudflare + Codex keys)",
        "/help",
        "/rename <title>",
      ].join("\n"));
      return new Response(JSON.stringify({ handled: true }), { headers: jsonHeaders });
    }

    if (parsed?.command === "rename") {
      await this.handleRename(message.message_id, settingsThreadId, parsed.args);
      return new Response(JSON.stringify({ handled: true }), { headers: jsonHeaders });
    }

    await this.sendTelegramMessage(
      message.message_id,
      settingsThreadId,
      "settings thread active. try /help",
    );
    return new Response(JSON.stringify({ handled: true }), { headers: jsonHeaders });
  }

  private async handleSettingsCommand(
    messageId: number,
    threadId: number | null,
  ): Promise<Response> {
    if (!threadId) {
      await this.sendTelegramMessage(
        messageId,
        null,
        "settings threads only work in forum topics",
      );
      return new Response(JSON.stringify({ handled: true }), { headers: jsonHeaders });
    }
    this.ctx.storage.sql.exec(SQL.UPDATE_SETTINGS, threadId, Date.now());
    await this.sendTelegramMessage(messageId, threadId, "settings thread set");
    return new Response(JSON.stringify({ handled: true }), { headers: jsonHeaders });
  }

  private async handleAuthCommand(
    message: TelegramMessage,
    settingsThreadId: number | null,
    isPrivate: boolean,
  ): Promise<Response> {
    const threadId = message.message_thread_id ?? null;
    if (!isPrivate) {
      if (settingsThreadId && threadId !== settingsThreadId) {
        await this.sendTelegramMessage(
          message.message_id,
          threadId,
          "use /auth inside the settings topic",
        );
        return new Response(JSON.stringify({ handled: true }), { headers: jsonHeaders });
      }
      if (!settingsThreadId) {
        const updatedThreadId = await this.ensureSettingsThread(message);
        if (!updatedThreadId) {
          await this.sendTelegramMessage(
            message.message_id,
            threadId,
            "enable topics or run /settings in a topic first",
          );
          return new Response(JSON.stringify({ handled: true }), { headers: jsonHeaders });
        }
        settingsThreadId = updatedThreadId;
        if (threadId === null) {
          await this.sendTelegramMessage(
            message.message_id,
            null,
            "settings topic created. continue there.",
          );
        }
      }
    }

    const authThreadId = isPrivate ? null : settingsThreadId ?? threadId;
    this.setAuthState({
      stage: "cloudflare_account_id",
      cloudflareAccountId: null,
      cloudflareApiToken: null,
      codexApiKey: null,
      updatedAt: Date.now(),
    });
    await this.sendTelegramMessage(
      message.message_id,
      authThreadId,
      "send Cloudflare account id",
    );
    return new Response(JSON.stringify({ handled: true }), { headers: jsonHeaders });
  }

  private async handleAuthInput(
    messageId: number,
    threadId: number | null,
    text: string,
    authState: AuthState,
  ): Promise<void> {
    const input = text.trim();
    if (!input) {
      await this.sendTelegramMessage(messageId, threadId, "send a value to continue");
      return;
    }
    if (authState.stage === "cloudflare_account_id") {
      this.setAuthState({
        stage: "cloudflare_api_token",
        cloudflareAccountId: input,
        cloudflareApiToken: null,
        codexApiKey: null,
        updatedAt: Date.now(),
      });
      await this.sendTelegramMessage(messageId, threadId, "send Cloudflare API token");
      return;
    }
    if (authState.stage === "cloudflare_api_token") {
      this.setAuthState({
        stage: "codex_api_key",
        cloudflareAccountId: authState.cloudflareAccountId ?? "",
        cloudflareApiToken: input,
        codexApiKey: null,
        updatedAt: Date.now(),
      });
      await this.sendTelegramMessage(messageId, threadId, "send Codex/OpenAI API key");
      return;
    }
    if (authState.stage === "codex_api_key") {
      if (!this.chatId) return;
      this.ctx.storage.sql.exec(
        SQL.UPSERT_CREDENTIALS,
        this.chatId,
        authState.cloudflareAccountId ?? "",
        authState.cloudflareApiToken ?? "",
        input,
        Date.now(),
      );
      this.clearAuthState();
      await this.sendTelegramMessage(messageId, threadId, "credentials saved");
    }
  }

  private async handleRename(
    messageId: number,
    threadId: number,
    title: string,
  ): Promise<void> {
    if (!title.trim()) {
      await this.sendTelegramMessage(messageId, threadId, "usage: /rename <title>");
      return;
    }
    if (this.chatId === null) return;
    const safeTitle = title.trim().slice(0, 128);
    const telegram = createTelegramClient(this.env.TELEGRAM_BOT_TOKEN);
    await pipe(
      telegram.editForumTopic({
        chat_id: this.chatId,
        message_thread_id: threadId,
        name: safeTitle,
      }),
      Effect.runPromise,
    );
    await this.sendTelegramMessage(messageId, threadId, `renamed topic to \"${safeTitle}\"`);
  }

  private async handleRegister(request: Request): Promise<Response> {
    if (!isAuthorized(request, this.env.MANAGER_CLI_TOKEN)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }
    const payload = await pipe(
      Effect.tryPromise({
        try: () => request.json(),
        catch: (error) => new Error(`Invalid JSON: ${error}`),
      }),
      Effect.flatMap(S.decodeUnknown(RegisterSchema)),
      Effect.mapError((error) => new Error(`Invalid register payload: ${error}`)),
      Effect.runPromise,
    );
    const input = payload as RegisterInput;
    this.ctx.storage.sql.exec(
      SQL.UPSERT_CREDENTIALS,
      input.chat_id,
      input.cloudflare_account_id,
      input.cloudflare_api_token,
      input.codex_api_key,
      Date.now(),
    );
    return new Response(JSON.stringify({ status: "ok" }), { headers: jsonHeaders });
  }

  private parseCommand(text: string): { command: string; args: string } | null {
    if (!text.startsWith("/")) return null;
    const [raw, ...rest] = text.split(/\s+/);
    const command = raw?.slice(1).split("@")[0];
    if (!command) return null;
    return { command, args: rest.join(" ").trim() };
  }

  private getSettingsThreadId(): number | null {
    const row = this.ctx.storage.sql.exec(SQL.GET_SETTINGS).one();
    const value = row?.settings_thread_id;
    return typeof value === "number" ? value : null;
  }

  private async sendTelegramMessage(
    replyTo: number,
    threadId: number | null,
    text: string,
  ): Promise<void> {
    if (this.chatId === null) return;
    const telegram = createTelegramClient(this.env.TELEGRAM_BOT_TOKEN);
    await pipe(
      telegram.sendMessage({
        chat_id: this.chatId,
        text,
        reply_to_message_id: replyTo,
        allow_sending_without_reply: true,
        message_thread_id: threadId ?? undefined,
      }),
      Effect.runPromise,
    );
  }

  private getAuthState(): AuthState {
    const row = this.ctx.storage.sql.exec(SQL.GET_AUTH).one();
    if (!row) {
      return {
        stage: null,
        cloudflareAccountId: null,
        cloudflareApiToken: null,
        codexApiKey: null,
        updatedAt: null,
      };
    }
    return {
      stage: (row.stage as AuthStage | null) ?? null,
      cloudflareAccountId: (row.cloudflare_account_id as string | null) ?? null,
      cloudflareApiToken: (row.cloudflare_api_token as string | null) ?? null,
      codexApiKey: (row.codex_api_key as string | null) ?? null,
      updatedAt: (row.updated_at as number | null) ?? null,
    };
  }

  private setAuthState(state: AuthState): void {
    this.ctx.storage.sql.exec(
      SQL.UPDATE_AUTH,
      state.stage,
      state.cloudflareAccountId,
      state.cloudflareApiToken,
      state.codexApiKey,
      state.updatedAt,
    );
  }

  private clearAuthState(): void {
    this.setAuthState({
      stage: null,
      cloudflareAccountId: null,
      cloudflareApiToken: null,
      codexApiKey: null,
      updatedAt: Date.now(),
    });
  }

  private async ensureSettingsThread(message: TelegramMessage): Promise<number | null> {
    if (this.chatId === null) return null;
    if (message.message_thread_id) {
      this.ctx.storage.sql.exec(SQL.UPDATE_SETTINGS, message.message_thread_id, Date.now());
      return message.message_thread_id;
    }
    const chatType = message.chat.type ?? "group";
    if (chatType === "private") return null;
    const telegram = createTelegramClient(this.env.TELEGRAM_BOT_TOKEN);
    try {
      const topic = await pipe(
        telegram.createForumTopic({
          chat_id: this.chatId,
          name: "settings",
        }),
        Effect.runPromise,
      );
      this.ctx.storage.sql.exec(
        SQL.UPDATE_SETTINGS,
        topic.message_thread_id,
        Date.now(),
      );
      await this.sendTelegramMessage(
        message.message_id,
        topic.message_thread_id,
        "settings topic ready. continue onboarding here.",
      );
      return topic.message_thread_id;
    } catch (error) {
      console.error("Failed to create settings topic", error);
      return null;
    }
  }
}
