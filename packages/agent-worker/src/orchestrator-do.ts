/**
 * Orchestrator Durable Object for Telegram -> Codex runs.
 */
import { DurableObject } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as S from "effect/Schema";

import { ExecProgressRenderer, isCodexEvent } from "./codex-progress.js";
import { createTelegramClient, decodeTelegramUpdate } from "./telegram.js";
import { TELEGRAM_LIMIT, truncateForTelegram, withResumeLine } from "./telegram-render.js";
import type { ChatState, Env, QueueItem, RunRequest } from "./types.js";

const SQL = {
  INIT: `
    CREATE TABLE IF NOT EXISTS chat_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      session_id TEXT,
      session_epoch INTEGER NOT NULL DEFAULT 0,
      active_run INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER
    );
    INSERT OR IGNORE INTO chat_state (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS message_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `,
  GET_STATE: `
    SELECT session_id, session_epoch, active_run, updated_at
    FROM chat_state
    WHERE id = 1
  `,
  UPDATE_STATE: `
    UPDATE chat_state
    SET session_id = ?, session_epoch = ?, active_run = ?, updated_at = ?
    WHERE id = 1
  `,
  QUEUE_COUNT: `
    SELECT COUNT(*) as count FROM message_queue
  `,
  ENQUEUE: `
    INSERT INTO message_queue (message_id, text, created_at)
    VALUES (?, ?, ?)
  `,
  DEQUEUE: `
    SELECT id, message_id, text, created_at
    FROM message_queue
    ORDER BY id ASC
    LIMIT 1
  `,
  DELETE_QUEUE_ITEM: `
    DELETE FROM message_queue WHERE id = ?
  `,
  CLEAR_QUEUE: `
    DELETE FROM message_queue
  `,
};

const RunRequestSchema = S.Struct({
  prompt: S.String,
  sessionId: S.optional(S.String),
  workdir: S.optional(S.String),
});

const decodeRunRequest = (input: unknown) =>
  pipe(
    Effect.succeed(input),
    Effect.flatMap(S.decodeUnknown(RunRequestSchema)),
    Effect.mapError((error) => new Error(`Invalid run request: ${error}`)),
  );

const getQueueCount = (sql: DurableObjectStorage["sql"]): number => {
  const row = sql.exec(SQL.QUEUE_COUNT).one() as { count: number } | null;
  return row?.count ?? 0;
};

const getChatState = (sql: DurableObjectStorage["sql"]): ChatState => {
  const row = sql.exec(SQL.GET_STATE).one();
  if (!row) {
    return { sessionId: null, sessionEpoch: 0, activeRun: 0, updatedAt: null };
  }
  return {
    sessionId: row.session_id as string | null,
    sessionEpoch: row.session_epoch as number,
    activeRun: row.active_run as number,
    updatedAt: row.updated_at as number | null,
  };
};

const setChatState = (sql: DurableObjectStorage["sql"], state: ChatState): void => {
  sql.exec(SQL.UPDATE_STATE, state.sessionId, state.sessionEpoch, state.activeRun, state.updatedAt);
};

const dequeueMessage = (sql: DurableObjectStorage["sql"]): QueueItem | null => {
  const row = sql.exec(SQL.DEQUEUE).one();
  if (!row) return null;
  const item: QueueItem = {
    id: row.id as number,
    messageId: row.message_id as number,
    text: row.text as string,
    createdAt: row.created_at as number,
  };
  sql.exec(SQL.DELETE_QUEUE_ITEM, item.id);
  return item;
};

export class OrchestratorDO extends DurableObject<Env> {
  private initialized = false;
  private chatId: number | null = null;
  private processing = false;

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(SQL.INIT);
    this.initialized = true;
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureInitialized();

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/handle") {
      const update = await pipe(decodeTelegramUpdate(await request.json()), Effect.runPromise);
      const message = update.message;
      if (!message?.text) {
        return new Response("ok");
      }

      this.chatId = message.chat.id;
      const text = message.text.trim();
      const command = this.parseCommand(text);
      if (command === "new") {
        await this.handleNewSession(message.message_id);
        return new Response("ok");
      }
      if (command === "help") {
        await this.handleHelp(message.message_id);
        return new Response("ok");
      }

      const queued = await this.enqueueMessage(message.message_id, text);
      if (!queued) {
        await this.sendQueueFull(message.message_id);
        return new Response("ok");
      }

      this.ctx.waitUntil(this.processQueue());
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }

  private parseCommand(text: string): string | null {
    if (!text.startsWith("/")) return null;
    const [raw] = text.split(/\s+/, 1);
    const command = raw?.slice(1).split("@")[0];
    return command ?? null;
  }

  private async handleNewSession(messageId: number): Promise<void> {
    const sql = this.ctx.storage.sql;
    sql.exec(SQL.CLEAR_QUEUE);
    const state = getChatState(sql);
    const updated: ChatState = {
      sessionId: null,
      sessionEpoch: state.sessionEpoch + 1,
      activeRun: state.activeRun,
      updatedAt: Date.now(),
    };
    setChatState(sql, updated);

    await this.sendTelegramMessage({
      text: "new session ready",
      replyTo: messageId,
    });
  }

  private async handleHelp(messageId: number): Promise<void> {
    await this.sendTelegramMessage({
      text: "commands: /new (reset session)",
      replyTo: messageId,
    });
  }

  private async enqueueMessage(messageId: number, text: string): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    const limit = this.getMaxQueueSize();
    if (getQueueCount(sql) >= limit) {
      return false;
    }
    sql.exec(SQL.ENQUEUE, messageId, text, Date.now());
    return true;
  }

  private async sendQueueFull(messageId: number): Promise<void> {
    await this.sendTelegramMessage({
      text: "queue full, try again soon",
      replyTo: messageId,
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.processNext();
    } finally {
      this.processing = false;
    }
  }

  private async processNext(): Promise<void> {
    const sql = this.ctx.storage.sql;
    const state = getChatState(sql);
    if (state.activeRun === 1) return;

    const item = dequeueMessage(sql);
    if (!item) return;

    setChatState(sql, {
      ...state,
      activeRun: 1,
      updatedAt: Date.now(),
    });

    try {
      await this.runMessage(item);
    } finally {
      const nextState = getChatState(sql);
      setChatState(sql, {
        ...nextState,
        activeRun: 0,
        updatedAt: Date.now(),
      });
    }

    await this.processNext();
  }

  private async runMessage(item: QueueItem): Promise<void> {
    const sql = this.ctx.storage.sql;
    const state = getChatState(sql);
    const startEpoch = state.sessionEpoch;
    const prompt = item.text;

    const progressId = await this.sendProgressMessage(item.messageId);
    if (!progressId) return;

    const container = this.getContainerStub();
    const runRequest: RunRequest = {
      prompt,
      sessionId: state.sessionId ?? undefined,
      workdir: this.env.CONTAINER_WORKDIR,
    };

    const response = await container.fetch("https://container/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runRequest),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text();
      await this.editProgress(progressId, `error: ${detail || response.statusText}`);
      return;
    }

    const renderer = new ExecProgressRenderer();
    const startedAt = Date.now();
    let lastEdit = 0;
    let sessionId = state.sessionId;
    let lastAnswer = "";
    let sawAgentMessage = false;
    let execError: string | null = null;

    const onEvent = async (event: Record<string, unknown>) => {
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        sessionId = event.thread_id;
      }

      if (event.type === "item.completed") {
        const itemValue = event.item;
        if (
          itemValue &&
          typeof itemValue === "object" &&
          typeof (itemValue as Record<string, unknown>).type === "string" &&
          (itemValue as Record<string, unknown>).type === "agent_message" &&
          typeof (itemValue as Record<string, unknown>).text === "string"
        ) {
          lastAnswer = (itemValue as Record<string, unknown>).text as string;
          sawAgentMessage = true;
        }
      }

      if (event.type === "exec.failed") {
        execError = typeof event.stderr === "string" ? event.stderr : "codex exec failed";
      }

      if (!renderer.noteEvent(event)) return;

      const now = Date.now();
      if (now - lastEdit < this.getProgressEditMs()) return;
      lastEdit = now;

      const elapsed = (now - startedAt) / 1000;
      const rendered = renderer.renderProgress(elapsed);
      const progress = sessionId ? withResumeLine(rendered, sessionId) : rendered;
      const truncated = truncateForTelegram(progress);
      await this.editProgress(progressId, truncated);
    };

    await this.consumeJsonlStream(response.body, onEvent);

    const elapsed = (Date.now() - startedAt) / 1000;
    const status = execError ? "error" : "done";
    const answer = execError
      ? `error: ${execError}`
      : sawAgentMessage
        ? lastAnswer
        : "(no response)";
    const finalText = withResumeLine(
      renderer.renderFinal(elapsed, answer, status),
      sessionId ?? null,
    );
    const needsNewMessage = finalText.length > TELEGRAM_LIMIT;
    const truncated = truncateForTelegram(finalText);

    await this.finishProgress(progressId, truncated, needsNewMessage);

    const latestState = getChatState(sql);
    if (latestState.sessionEpoch === startEpoch) {
      setChatState(sql, {
        ...latestState,
        sessionId: sessionId ?? latestState.sessionId,
        updatedAt: Date.now(),
      });
    }
  }

  private async consumeJsonlStream(
    stream: ReadableStream<Uint8Array>,
    onEvent: (event: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const flushLines = async (text: string) => {
      const lines = text.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (isCodexEvent(parsed)) {
          await onEvent(parsed);
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      await flushLines(buffer);
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        if (isCodexEvent(parsed)) {
          await onEvent(parsed);
        }
      } catch {
        // ignore trailing partial
      }
    }
  }

  private async sendProgressMessage(replyToMessageId: number): Promise<number | null> {
    const progress = truncateForTelegram("working - 0s");
    const result = await this.sendTelegramMessage({
      text: progress,
      replyTo: replyToMessageId,
      silent: true,
    });
    return result?.message_id ?? null;
  }

  private async editProgress(messageId: number, text: string): Promise<void> {
    await this.sendTelegramEdit({ messageId, text });
  }

  private async finishProgress(
    messageId: number,
    text: string,
    sendNewMessage: boolean,
  ): Promise<void> {
    if (!sendNewMessage) {
      await this.sendTelegramEdit({ messageId, text });
      return;
    }

    await this.sendTelegramMessage({ text, replyTo: messageId });
    await this.deleteTelegramMessage(messageId);
  }

  private async sendTelegramMessage(input: {
    text: string;
    replyTo?: number;
    silent?: boolean;
  }): Promise<{ message_id: number } | null> {
    const chatId = this.chatId;
    if (chatId === null) return null;
    const telegram = createTelegramClient(this.env.TELEGRAM_BOT_TOKEN);
    const result = await pipe(
      telegram.sendMessage({
        chat_id: chatId,
        text: input.text,
        reply_to_message_id: input.replyTo,
        disable_notification: input.silent,
      }),
      Effect.runPromise,
    );
    return result ?? null;
  }

  private async sendTelegramEdit(input: { messageId: number; text: string }): Promise<void> {
    const chatId = this.chatId;
    if (chatId === null) return;
    const telegram = createTelegramClient(this.env.TELEGRAM_BOT_TOKEN);
    await pipe(
      telegram.editMessageText({
        chat_id: chatId,
        message_id: input.messageId,
        text: input.text,
      }),
      Effect.runPromise,
    );
  }

  private async deleteTelegramMessage(messageId: number): Promise<void> {
    const chatId = this.chatId;
    if (chatId === null) return;
    const telegram = createTelegramClient(this.env.TELEGRAM_BOT_TOKEN);
    await pipe(telegram.deleteMessage(chatId, messageId), Effect.runPromise);
  }

  private getContainerStub() {
    const chatId = this.chatId ?? 0;
    const containerId = this.env.AGENT_CONTAINER.idFromName(String(chatId));
    return this.env.AGENT_CONTAINER.get(containerId);
  }

  private getMaxQueueSize(): number {
    const raw = this.env.MAX_QUEUE_SIZE;
    const parsed = raw ? Number(raw) : 5;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  }

  private getProgressEditMs(): number {
    const raw = this.env.PROGRESS_EDIT_MS;
    const parsed = raw ? Number(raw) : 2000;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
  }
}
