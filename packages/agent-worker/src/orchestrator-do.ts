/**
 * Orchestrator Durable Object for Telegram -> Codex runs.
 */
import { DurableObject } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as S from "effect/Schema";

import { ExecProgressRenderer, isCodexEvent } from "./codex-progress.js";
import {
  buildTelegramChatKey,
  createTelegramClient,
  decodeTelegramUpdate,
} from "./telegram.js";
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
      message_thread_id INTEGER,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_debug (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_message_id INTEGER,
      last_progress_id INTEGER,
      last_event_type TEXT,
      last_event_at INTEGER,
      last_error TEXT,
      last_container_error TEXT,
      last_container_status INTEGER,
      last_container_detail TEXT
    );
    INSERT OR IGNORE INTO run_debug (id) VALUES (1);
  `,
  ALTER_QUEUE_ADD_THREAD: `
    ALTER TABLE message_queue
    ADD COLUMN message_thread_id INTEGER
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
    INSERT INTO message_queue (message_id, message_thread_id, text, created_at)
    VALUES (?, ?, ?, ?)
  `,
  DEQUEUE: `
    SELECT id, message_id, message_thread_id, text, created_at
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
  GET_RUN_DEBUG: `
    SELECT
      last_message_id,
      last_progress_id,
      last_event_type,
      last_event_at,
      last_error,
      last_container_error,
      last_container_status,
      last_container_detail
    FROM run_debug
    WHERE id = 1
  `,
  UPDATE_RUN_DEBUG: `
    UPDATE run_debug
    SET
      last_message_id = ?,
      last_progress_id = ?,
      last_event_type = ?,
      last_event_at = ?,
      last_error = ?,
      last_container_error = ?,
      last_container_status = ?,
      last_container_detail = ?
    WHERE id = 1
  `,
};

const ACTIVE_RUN_STALE_MS = 5 * 60 * 1000;
const DEFAULT_RUN_START_TIMEOUT_MS = 120 * 1000;
const DEFAULT_RUN_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_RUN_MAX_MS = 30 * 60 * 1000;
const timeoutSentinel = Symbol("timeout");

const sleep = (ms: number) =>
  new Promise<typeof timeoutSentinel>((resolve) => {
    setTimeout(() => resolve(timeoutSentinel), ms);
  });

const RunRequestSchema = S.Struct({
  prompt: S.String,
  sessionId: S.optional(S.String),
  workdir: S.optional(S.String),
});

const ContainerStateSchema = S.Struct({
  status: S.Literal("idle", "starting", "running", "stopping", "stopped", "error"),
  instanceId: S.Union(S.String, S.Null),
  startedAt: S.Union(S.Number, S.Null),
  stoppedAt: S.Union(S.Number, S.Null),
  error: S.Union(S.String, S.Null),
});

const decodeRunRequest = (input: unknown) =>
  pipe(
    Effect.succeed(input),
    Effect.flatMap(S.decodeUnknown(RunRequestSchema)),
    Effect.mapError((error) => new Error(`Invalid run request: ${error}`)),
  );

const decodeContainerState = (input: unknown) =>
  pipe(
    Effect.succeed(input),
    Effect.flatMap(S.decodeUnknown(ContainerStateSchema)),
    Effect.mapError((error) => new Error(`Invalid container state: ${error}`)),
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

type RunDebug = {
  lastMessageId: number | null;
  lastProgressId: number | null;
  lastEventType: string | null;
  lastEventAt: number | null;
  lastError: string | null;
  lastContainerError: string | null;
  lastContainerStatus: number | null;
  lastContainerDetail: string | null;
};

const defaultRunDebug = (): RunDebug => ({
  lastMessageId: null,
  lastProgressId: null,
  lastEventType: null,
  lastEventAt: null,
  lastError: null,
  lastContainerError: null,
  lastContainerStatus: null,
  lastContainerDetail: null,
});

const getRunDebug = (sql: DurableObjectStorage["sql"]): RunDebug => {
  const row = sql.exec(SQL.GET_RUN_DEBUG).one();
  if (!row) return defaultRunDebug();
  return {
    lastMessageId: row.last_message_id as number | null,
    lastProgressId: row.last_progress_id as number | null,
    lastEventType: row.last_event_type as string | null,
    lastEventAt: row.last_event_at as number | null,
    lastError: row.last_error as string | null,
    lastContainerError: row.last_container_error as string | null,
    lastContainerStatus: row.last_container_status as number | null,
    lastContainerDetail: row.last_container_detail as string | null,
  };
};

const setRunDebug = (sql: DurableObjectStorage["sql"], debug: RunDebug): void => {
  sql.exec(
    SQL.UPDATE_RUN_DEBUG,
    debug.lastMessageId,
    debug.lastProgressId,
    debug.lastEventType,
    debug.lastEventAt,
    debug.lastError,
    debug.lastContainerError,
    debug.lastContainerStatus,
    debug.lastContainerDetail,
  );
};

const isStaleActiveRun = (state: ChatState): boolean => {
  if (state.activeRun !== 1) return false;
  if (state.updatedAt === null) return true;
  return Date.now() - state.updatedAt > ACTIVE_RUN_STALE_MS;
};

const dequeueMessage = (sql: DurableObjectStorage["sql"]): QueueItem | null => {
  const row = sql.exec(SQL.DEQUEUE).one();
  if (!row) return null;
  const item: QueueItem = {
    id: row.id as number,
    messageId: row.message_id as number,
    threadId: (row.message_thread_id as number | null) ?? null,
    text: row.text as string,
    createdAt: row.created_at as number,
  };
  sql.exec(SQL.DELETE_QUEUE_ITEM, item.id);
  return item;
};

export class OrchestratorDO extends DurableObject<Env> {
  private initialized = false;
  private chatId: number | null = null;
  private chatKey: string | null = null;
  private processing = false;
  private currentAbort: AbortController | null = null;

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(SQL.INIT);
    try {
      this.ctx.storage.sql.exec(SQL.ALTER_QUEUE_ADD_THREAD);
    } catch {
      // ignore when column already exists
    }
    this.initialized = true;
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureInitialized();

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/debug") {
      return this.handleDebug();
    }
    if (request.method === "POST" && url.pathname === "/debug/reset") {
      return this.handleDebugReset();
    }
    if (request.method === "POST" && url.pathname === "/handle") {
      const update = await pipe(decodeTelegramUpdate(await request.json()), Effect.runPromise);
      const message = update.message;
      if (!message?.text) {
        return new Response("ok");
      }

      this.chatId = message.chat.id;
      this.chatKey = buildTelegramChatKey(
        message.chat.id,
        message.message_thread_id ?? null,
      );
      const text = message.text.trim();
      const parsed = this.parseCommand(text);
      if (parsed?.command === "new") {
        await this.handleNewSession(message.message_id, message.message_thread_id ?? null);
        return new Response("ok");
      }
      if (parsed?.command === "help") {
        await this.handleHelp(message.message_id, message.message_thread_id ?? null);
        return new Response("ok");
      }
      if (parsed?.command === "rename") {
        await this.handleRename(
          message.message_id,
          message.message_thread_id ?? null,
          parsed.args,
        );
        return new Response("ok");
      }

      const queued = await this.enqueueMessage(
        message.message_id,
        message.message_thread_id ?? null,
        text,
      );
      if (!queued) {
        await this.sendQueueFull(message.message_id, message.message_thread_id ?? null);
        return new Response("ok");
      }

      this.ctx.waitUntil(this.processQueue());
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }

  private handleDebug(): Response {
    const state = getChatState(this.ctx.storage.sql);
    const queueCount = getQueueCount(this.ctx.storage.sql);
    const runDebug = getRunDebug(this.ctx.storage.sql);
    return new Response(
      JSON.stringify({
        chatId: this.chatId,
        chatKey: this.chatKey,
        processing: this.processing,
        queueCount,
        state,
        runDebug,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  private handleDebugReset(): Response {
    const sql = this.ctx.storage.sql;
    sql.exec(SQL.CLEAR_QUEUE);
    const state = getChatState(sql);
    setChatState(sql, {
      ...state,
      sessionId: null,
      activeRun: 0,
      updatedAt: Date.now(),
    });
    setRunDebug(sql, defaultRunDebug());
    this.abortActiveRun("debug reset");
    this.processing = false;
    return this.handleDebug();
  }

  private abortActiveRun(reason: string): void {
    if (!this.currentAbort) return;
    console.warn("[orchestrator] aborting active run", { reason });
    this.currentAbort.abort(reason);
    this.currentAbort = null;
  }

  private parseCommand(text: string): { command: string; args: string } | null {
    if (!text.startsWith("/")) return null;
    const [raw, ...rest] = text.split(/\s+/);
    const command = raw?.slice(1).split("@")[0];
    if (!command) return null;
    return { command, args: rest.join(" ").trim() };
  }

  private async handleNewSession(messageId: number, threadId: number | null): Promise<void> {
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
      threadId,
    });
  }

  private async handleHelp(messageId: number, threadId: number | null): Promise<void> {
    await this.sendTelegramMessage({
      text: [
        "commands:",
        "/new (reset session)",
        "/rename <title>",
        "/settings (set this topic as settings thread)",
        "/auth (store Cloudflare + Codex keys)",
      ].join("\n"),
      replyTo: messageId,
      threadId,
    });
  }

  private async handleRename(
    messageId: number,
    threadId: number | null,
    title: string,
  ): Promise<void> {
    const chatId = this.chatId;
    if (chatId === null) return;
    const trimmed = title.trim();
    if (!threadId) {
      await this.sendTelegramMessage({
        text: "rename only works inside a topic",
        replyTo: messageId,
        threadId,
      });
      return;
    }
    if (!trimmed) {
      await this.sendTelegramMessage({
        text: "usage: /rename <title>",
        replyTo: messageId,
        threadId,
      });
      return;
    }
    const safeTitle = trimmed.slice(0, 128);
    const telegram = createTelegramClient(this.env.TELEGRAM_BOT_TOKEN);
    await pipe(
      telegram.editForumTopic({
        chat_id: chatId,
        message_thread_id: threadId,
        name: safeTitle,
      }),
      Effect.runPromise,
    );
    await this.sendTelegramMessage({
      text: `renamed topic to "${safeTitle}"`,
      replyTo: messageId,
      threadId,
    });
  }

  private async enqueueMessage(
    messageId: number,
    threadId: number | null,
    text: string,
  ): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    const limit = this.getMaxQueueSize();
    if (getQueueCount(sql) >= limit) {
      return false;
    }
    sql.exec(SQL.ENQUEUE, messageId, threadId, text, Date.now());
    return true;
  }

  private async sendQueueFull(messageId: number, threadId: number | null): Promise<void> {
    await this.sendTelegramMessage({
      text: "queue full, try again soon",
      replyTo: messageId,
      threadId,
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
    if (state.activeRun === 1) {
      const containerState = await this.fetchContainerState();
      const containerStopped =
        containerState !== null &&
        containerState.status !== "running" &&
        containerState.status !== "starting";
      if (!containerStopped && !isStaleActiveRun(state)) {
        return;
      }
      console.warn("[orchestrator] clearing stale run", {
        updatedAt: state.updatedAt,
        containerStatus: containerState?.status ?? "unknown",
      });
      this.abortActiveRun("stale run");
      setChatState(sql, {
        ...state,
        activeRun: 0,
        updatedAt: Date.now(),
      });
      if (this.chatId !== null) {
        try {
          await this.getContainerStub().fetch("https://container/stop", { method: "POST" });
        } catch (error) {
          console.error("[orchestrator] failed to stop stale container", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

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
    console.log("[orchestrator] run start", {
      chatId: this.chatId,
      threadId: item.threadId,
      messageId: item.messageId,
      promptSize: prompt.length,
      hasSession: Boolean(state.sessionId),
    });

    const progressId = await this.sendProgressMessage(item.messageId, item.threadId);
    this.recordRunStart(item.messageId, progressId);
    if (!progressId) return;

    const runRequest: RunRequest = {
      prompt,
      sessionId: state.sessionId ?? undefined,
      workdir: this.env.CONTAINER_WORKDIR,
    };

    const abortController = new AbortController();
    this.currentAbort = abortController;

    try {
      const response = await this.fetchContainerRun(runRequest, abortController);
      console.log("[orchestrator] container response", { status: response.status });

      if (!response.ok || !response.body) {
        const detail = await response.text();
        this.recordContainerResponse(response.status, detail);
        console.error("[orchestrator] container error response", {
          status: response.status,
          detail: detail.slice(0, 200),
        });
        await this.editProgress(
          progressId,
          truncateForTelegram(`error: ${detail || response.statusText}`),
        );
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
        this.touchActiveRun();
        if (typeof event.type === "string" && event.type !== "item.updated") {
          this.recordRunEvent(event.type);
        }
        if (event.type === "debug.env") {
          const hasOpenai = typeof event.has_openai_key === "boolean" ? event.has_openai_key : null;
          const hasCodex = typeof event.has_codex_key === "boolean" ? event.has_codex_key : null;
          this.recordRunEventDetail(
            "debug.env",
            JSON.stringify({ has_openai_key: hasOpenai, has_codex_key: hasCodex }),
          );
        }
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
          this.recordRunError(execError);
          console.error("[orchestrator] exec failed", {
            stderr: execError.slice(0, 200),
          });
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

      await this.consumeJsonlStream(response.body, onEvent, {
        signal: abortController.signal,
        idleTimeoutMs: this.getRunIdleTimeoutMs(),
        maxDurationMs: this.getRunMaxMs(),
      });

      const elapsed = (Date.now() - startedAt) / 1000;
      const status = execError ? "error" : "done";
      const answer = execError
        ? `error: ${execError}`
        : sawAgentMessage
          ? lastAnswer
          : "(no response)";
      console.log("[orchestrator] run finished", {
        status,
        elapsed,
        sawAgentMessage,
        sessionId: sessionId ?? null,
      });
      const finalText = withResumeLine(
        renderer.renderFinal(elapsed, answer, status),
        sessionId ?? null,
      );
      const needsNewMessage = finalText.length > TELEGRAM_LIMIT;
      const truncated = truncateForTelegram(finalText);

      await this.finishProgress(progressId, truncated, needsNewMessage, item.threadId);

      const latestState = getChatState(sql);
      if (latestState.sessionEpoch === startEpoch) {
        setChatState(sql, {
          ...latestState,
          sessionId: sessionId ?? latestState.sessionId,
          updatedAt: Date.now(),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "codex run failed";
      this.recordRunError(message);
      console.error("[orchestrator] run error", { error: message });
      await this.editProgress(progressId, truncateForTelegram(`error: ${message}`));
    } finally {
      if (this.currentAbort === abortController) {
        this.currentAbort = null;
      }
    }
  }

  private async consumeJsonlStream(
    stream: ReadableStream<Uint8Array>,
    onEvent: (event: Record<string, unknown>) => Promise<void>,
    options: { signal: AbortSignal; idleTimeoutMs: number; maxDurationMs: number },
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const startedAt = Date.now();

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
      if (options.signal.aborted) {
        await reader.cancel();
        const reason = options.signal.reason;
        const message =
          typeof reason === "string" && reason.trim().length > 0
            ? reason
            : "codex run aborted";
        throw new Error(message);
      }

      const elapsed = Date.now() - startedAt;
      const remaining = options.maxDurationMs - elapsed;
      if (remaining <= 0) {
        await reader.cancel();
        throw new Error(`codex run exceeded ${options.maxDurationMs}ms`);
      }

      const timeoutMs = Math.min(options.idleTimeoutMs, remaining);
      const result = await Promise.race([reader.read(), sleep(timeoutMs)]);
      if (result === timeoutSentinel) {
        await reader.cancel();
        throw new Error(`codex stream idle for ${timeoutMs}ms`);
      }
      if (result.done) break;
      if (!result.value) continue;
      buffer += decoder.decode(result.value, { stream: true });
      this.touchActiveRun();
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

  private async sendProgressMessage(
    replyToMessageId: number,
    threadId: number | null,
  ): Promise<number | null> {
    const progress = truncateForTelegram("working - 0s");
    const result = await this.sendTelegramMessage({
      text: progress,
      replyTo: replyToMessageId,
      silent: true,
      threadId,
    });
    return result?.message_id ?? null;
  }

  private async editProgress(messageId: number, text: string): Promise<void> {
    await this.sendTelegramEdit({ messageId, text });
    this.touchActiveRun();
  }

  private async finishProgress(
    messageId: number,
    text: string,
    sendNewMessage: boolean,
    threadId: number | null,
  ): Promise<void> {
    if (!sendNewMessage) {
      await this.sendTelegramEdit({ messageId, text });
      return;
    }

    await this.sendTelegramMessage({ text, replyTo: messageId, threadId });
    await this.deleteTelegramMessage(messageId);
  }

  private async sendTelegramMessage(input: {
    text: string;
    replyTo?: number;
    silent?: boolean;
    threadId?: number | null;
  }): Promise<{ message_id: number } | null> {
    const chatId = this.chatId;
    if (chatId === null) return null;
    try {
      const telegram = createTelegramClient(this.env.TELEGRAM_BOT_TOKEN);
      const result = await pipe(
        telegram.sendMessage({
          chat_id: chatId,
          text: input.text,
          message_thread_id: input.threadId ?? undefined,
          reply_to_message_id: input.replyTo,
          allow_sending_without_reply: input.replyTo ? true : undefined,
          disable_notification: input.silent,
        }),
        Effect.runPromise,
      );
      return result ?? null;
    } catch (error) {
      console.error("[orchestrator] telegram send failed", {
        chatId,
        threadId: input.threadId ?? null,
        replyTo: input.replyTo ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async sendTelegramEdit(input: { messageId: number; text: string }): Promise<void> {
    const chatId = this.chatId;
    if (chatId === null) return;
    try {
      const telegram = createTelegramClient(this.env.TELEGRAM_BOT_TOKEN);
      await pipe(
        telegram.editMessageText({
          chat_id: chatId,
          message_id: input.messageId,
          text: input.text,
        }),
        Effect.runPromise,
      );
    } catch (error) {
      console.error("[orchestrator] telegram edit failed", {
        chatId,
        messageId: input.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async deleteTelegramMessage(messageId: number): Promise<void> {
    const chatId = this.chatId;
    if (chatId === null) return;
    try {
      const telegram = createTelegramClient(this.env.TELEGRAM_BOT_TOKEN);
      await pipe(telegram.deleteMessage(chatId, messageId), Effect.runPromise);
    } catch (error) {
      console.error("[orchestrator] telegram delete failed", {
        chatId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private getContainerStub() {
    const key = this.chatKey ?? String(this.chatId ?? 0);
    const containerId = this.env.AGENT_CONTAINER.idFromName(key);
    return this.env.AGENT_CONTAINER.get(containerId);
  }

  private parsePositiveMs(raw: string | undefined, fallback: number): number {
    const parsed = raw ? Number(raw) : fallback;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private getRunStartTimeoutMs(): number {
    return this.parsePositiveMs(this.env.RUN_START_TIMEOUT_MS, DEFAULT_RUN_START_TIMEOUT_MS);
  }

  private getRunIdleTimeoutMs(): number {
    return this.parsePositiveMs(this.env.RUN_IDLE_TIMEOUT_MS, DEFAULT_RUN_IDLE_TIMEOUT_MS);
  }

  private getRunMaxMs(): number {
    return this.parsePositiveMs(this.env.RUN_MAX_MS, DEFAULT_RUN_MAX_MS);
  }

  private async fetchContainerRun(
    runRequest: RunRequest,
    controller: AbortController,
  ): Promise<Response> {
    const timeoutMs = this.getRunStartTimeoutMs();
    const timer = setTimeout(
      () => controller.abort(`container run start timed out after ${timeoutMs}ms`),
      timeoutMs,
    );
    try {
      return await this.getContainerStub().fetch("https://container/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runRequest),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        const message =
          typeof reason === "string" && reason.trim().length > 0
            ? reason
            : "container run aborted";
        throw new Error(message);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchContainerState(): Promise<S.Schema.Type<typeof ContainerStateSchema> | null> {
    if (this.chatId === null) return null;
    try {
      const response = await this.getContainerStub().fetch("https://container/status");
      if (!response.ok) return null;
      const payload = (await response.json()) as unknown;
      return await pipe(decodeContainerState(payload), Effect.runPromise);
    } catch (error) {
      console.error("[orchestrator] failed to fetch container status", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private touchActiveRun(): void {
    const sql = this.ctx.storage.sql;
    const state = getChatState(sql);
    if (state.activeRun !== 1) return;
    setChatState(sql, { ...state, updatedAt: Date.now() });
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

  private recordRunStart(messageId: number, progressId: number | null): void {
    const sql = this.ctx.storage.sql;
    const debug = getRunDebug(sql);
    setRunDebug(sql, {
      ...debug,
      lastMessageId: messageId,
      lastProgressId: progressId,
      lastEventType: "run.start",
      lastEventAt: Date.now(),
      lastError: null,
      lastContainerError: null,
      lastContainerStatus: null,
      lastContainerDetail: null,
    });
  }

  private recordRunEvent(eventType: string): void {
    const sql = this.ctx.storage.sql;
    const debug = getRunDebug(sql);
    setRunDebug(sql, {
      ...debug,
      lastEventType: eventType,
      lastEventAt: Date.now(),
    });
  }

  private recordRunEventDetail(eventType: string, detail: string): void {
    const sql = this.ctx.storage.sql;
    const debug = getRunDebug(sql);
    setRunDebug(sql, {
      ...debug,
      lastEventType: eventType,
      lastEventAt: Date.now(),
      lastContainerDetail: detail.slice(0, 500),
    });
  }

  private recordRunError(message: string): void {
    const sql = this.ctx.storage.sql;
    const debug = getRunDebug(sql);
    setRunDebug(sql, {
      ...debug,
      lastError: message,
      lastEventType: "run.error",
      lastEventAt: Date.now(),
    });
  }

  private recordContainerResponse(status: number, detail: string): void {
    const sql = this.ctx.storage.sql;
    const debug = getRunDebug(sql);
    setRunDebug(sql, {
      ...debug,
      lastContainerStatus: status,
      lastContainerDetail: detail.slice(0, 500),
      lastEventType: "container.response",
      lastEventAt: Date.now(),
    });
  }
}
