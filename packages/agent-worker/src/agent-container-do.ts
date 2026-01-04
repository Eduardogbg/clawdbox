/**
 * Agent Container Durable Object
 *
 * Container-enabled DO that runs the Codex runner service.
 */
import { Container } from "@cloudflare/containers";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as S from "effect/Schema";

import type { ContainerState, Env, RunRequest } from "./types.js";

const SQL = {
  INIT: `
    CREATE TABLE IF NOT EXISTS container_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      instance_id TEXT,
      started_at INTEGER,
      stopped_at INTEGER,
      error TEXT
    );
    INSERT OR IGNORE INTO container_state (id) VALUES (1);
  `,
  GET_STATE: `
    SELECT status, instance_id, started_at, stopped_at, error
    FROM container_state
    WHERE id = 1
  `,
  UPDATE_STATE: `
    UPDATE container_state
    SET status = ?, instance_id = ?, started_at = ?, stopped_at = ?, error = ?
    WHERE id = 1
  `,
};

const DEFAULT_CONTAINER_READY_TIMEOUT_MS = 20_000;
const DEFAULT_CONTAINER_READY_INTERVAL_MS = 500;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

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

const getState = (sql: DurableObjectStorage["sql"]): ContainerState => {
  const row = sql.exec(SQL.GET_STATE).one();
  if (!row) {
    return {
      status: "idle",
      instanceId: null,
      startedAt: null,
      stoppedAt: null,
      error: null,
    };
  }
  return {
    status: row.status as ContainerState["status"],
    instanceId: row.instance_id as string | null,
    startedAt: row.started_at as number | null,
    stoppedAt: row.stopped_at as number | null,
    error: row.error as string | null,
  };
};

const setState = (sql: DurableObjectStorage["sql"], state: ContainerState): void => {
  sql.exec(
    SQL.UPDATE_STATE,
    state.status,
    state.instanceId,
    state.startedAt,
    state.stoppedAt,
    state.error,
  );
};

export class AgentContainerDO extends Container<Env> {
  private initialized = false;

  override defaultPort = 8080;
  override sleepAfter = "1h";

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(SQL.INIT);
    this.initialized = true;
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureInitialized();
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status") {
      return this.handleStatus();
    }
    if (request.method === "POST" && url.pathname === "/run") {
      return this.handleRun(request);
    }
    if (request.method === "GET" && url.pathname === "/ping") {
      return this.handlePing();
    }
    if (request.method === "GET" && url.pathname === "/debug/env") {
      return this.handleDebugEnv();
    }
    if (request.method === "POST" && url.pathname === "/stop") {
      return this.handleStop();
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return this.handleHealth();
    }
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  private handleStatus(): Response {
    const state = getState(this.ctx.storage.sql);
    return new Response(JSON.stringify(state), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleRun(request: Request): Promise<Response> {
    const runRequest = await pipe(decodeRunRequest(await request.json()), Effect.runPromise);
    try {
      await this.ensureContainerReady();
    } catch (error) {
      const message = error instanceof Error ? error.message : "container failed to start";
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const forward = new Request("http://container/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runRequest as RunRequest),
    });
    return this.containerFetch(forward);
  }

  private async handleStop(): Promise<Response> {
    const state = getState(this.ctx.storage.sql);
    if (state.status !== "running" && state.status !== "starting") {
      return new Response(JSON.stringify({ status: "already stopped" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    setState(this.ctx.storage.sql, {
      ...state,
      status: "stopping",
    });

    try {
      await this.stop();
      setState(this.ctx.storage.sql, {
        ...state,
        status: "stopped",
        stoppedAt: Date.now(),
      });
      return new Response(JSON.stringify({ status: "stopped" }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      setState(this.ctx.storage.sql, {
        ...state,
        status: "error",
        error: error instanceof Error ? error.message : "failed to stop",
        stoppedAt: Date.now(),
      });
      return new Response(JSON.stringify({ error: "failed to stop" }), { status: 500 });
    }
  }

  private handleHealth(): Response {
    const state = getState(this.ctx.storage.sql);
    return new Response(
      JSON.stringify({
        status: state.status,
        instanceId: state.instanceId,
        startedAt: state.startedAt,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  private async handlePing(): Promise<Response> {
    try {
      await this.ensureContainerReady();
      const response = await this.containerFetch("http://container/health");
      const bodyText = await response.text();
      return new Response(
        JSON.stringify({
          state: getState(this.ctx.storage.sql),
          status: response.status,
          body: bodyText,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to reach container";
      return new Response(
        JSON.stringify({
          state: getState(this.ctx.storage.sql),
          error: message,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  override onStart(): void {
    const state = getState(this.ctx.storage.sql);
    setState(this.ctx.storage.sql, {
      ...state,
      status: "running",
      startedAt: Date.now(),
      error: null,
    });
  }

  override onStop(params: { exitCode: number }): void {
    const state = getState(this.ctx.storage.sql);
    if (params.exitCode === 0) {
      setState(this.ctx.storage.sql, {
        ...state,
        status: "stopped",
        stoppedAt: Date.now(),
      });
      return;
    }

    setState(this.ctx.storage.sql, {
      ...state,
      status: "error",
      error: `container exited with code ${params.exitCode}`,
      stoppedAt: Date.now(),
    });
  }

  override onError(error: unknown): void {
    const state = getState(this.ctx.storage.sql);
    setState(this.ctx.storage.sql, {
      ...state,
      status: "error",
      error: error instanceof Error ? error.message : "unknown error",
      stoppedAt: Date.now(),
    });
  }

  private async startContainer(): Promise<void> {
    const instanceId = this.ctx.id.toString();
    const state = getState(this.ctx.storage.sql);
    setState(this.ctx.storage.sql, {
      ...state,
      status: "starting",
      instanceId,
      startedAt: Date.now(),
      error: null,
    });

    const envVars = this.buildContainerEnvVars();

    await this.start({ envVars });
  }

  private async ensureContainerReady(): Promise<void> {
    const sql = this.ctx.storage.sql;
    const state = getState(sql);
    if (state.status === "idle" || state.status === "stopped" || state.status === "error") {
      await this.startContainer();
    }

    const firstAttempt = await this.waitForContainerHealth();
    if (firstAttempt.ok) return;

    console.warn("[agent-container] health check failed, restarting", {
      error: firstAttempt.error,
    });

    try {
      await this.stop();
    } catch (error) {
      console.warn("[agent-container] stop failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await this.startContainer();
    const secondAttempt = await this.waitForContainerHealth();
    if (secondAttempt.ok) return;

    const message = secondAttempt.error ?? "container failed readiness check";
    const latest = getState(sql);
    setState(sql, {
      ...latest,
      status: "error",
      error: message,
      stoppedAt: Date.now(),
    });
    throw new Error(message);
  }

  private async waitForContainerHealth(): Promise<{ ok: boolean; error?: string }> {
    const startedAt = Date.now();
    let lastError: string | undefined;

    while (Date.now() - startedAt < DEFAULT_CONTAINER_READY_TIMEOUT_MS) {
      try {
        const response = await this.containerFetch("http://container/health");
        if (response.ok) return { ok: true };
        const body = await response.text();
        lastError = `health check failed (${response.status}): ${body.slice(0, 200)}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      await sleep(DEFAULT_CONTAINER_READY_INTERVAL_MS);
    }

    return { ok: false, error: lastError ?? "container did not become ready" };
  }

  private async handleDebugEnv(): Promise<Response> {
    const apiKey = this.env.CODEX_API_KEY ?? this.env.OPENAI_API_KEY;
    const doEnv = {
      hasCodexApiKey: Boolean(this.env.CODEX_API_KEY),
      hasOpenaiApiKey: Boolean(this.env.OPENAI_API_KEY),
      hasCodexArgs: Boolean(this.env.CODEX_ARGS),
      hasCodexProfile: Boolean(this.env.CODEX_PROFILE),
      hasContainerWorkdir: Boolean(this.env.CONTAINER_WORKDIR),
      hasContainerRepoUrl: Boolean(this.env.CONTAINER_REPO_URL),
      hasContainerRepoBranch: Boolean(this.env.CONTAINER_REPO_BRANCH),
      hasResolvedApiKey: Boolean(apiKey),
    };
    const envVars = this.buildContainerEnvVars();
    try {
      await this.ensureContainerReady();
      const response = await this.containerFetch("http://container/debug/env");
      const bodyText = await response.text();
      let containerEnv: unknown = bodyText;
      try {
        containerEnv = JSON.parse(bodyText) as unknown;
      } catch {
        containerEnv = bodyText;
      }
      return new Response(
        JSON.stringify({
          doEnv,
          envVarsKeys: Object.keys(envVars),
          containerStatus: response.status,
          containerEnv,
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to reach container";
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private buildContainerEnvVars(): Record<string, string> {
    const envVars: Record<string, string> = {};
    const apiKey = this.env.CODEX_API_KEY ?? this.env.OPENAI_API_KEY;
    if (apiKey) {
      envVars.CODEX_API_KEY = apiKey;
      envVars.OPENAI_API_KEY = apiKey;
    }
    if (this.env.CODEX_PROFILE) {
      envVars.CODEX_PROFILE = this.env.CODEX_PROFILE;
    }
    if (this.env.CODEX_ARGS) {
      envVars.CODEX_ARGS = this.env.CODEX_ARGS;
    }
    if (this.env.CONTAINER_WORKDIR) {
      envVars.CODEX_WORKDIR = this.env.CONTAINER_WORKDIR;
    }
    if (this.env.CONTAINER_REPO_URL) {
      envVars.REPO_URL = this.env.CONTAINER_REPO_URL;
    }
    if (this.env.CONTAINER_REPO_BRANCH) {
      envVars.REPO_BRANCH = this.env.CONTAINER_REPO_BRANCH;
    }
    return envVars;
  }
}
