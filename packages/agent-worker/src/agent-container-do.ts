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
    const state = getState(this.ctx.storage.sql);
    if (state.status === "idle" || state.status === "stopped" || state.status === "error") {
      await this.startContainer();
    }

    const runRequest = await pipe(decodeRunRequest(await request.json()), Effect.runPromise);
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

    await this.start({ envVars });
  }
}
