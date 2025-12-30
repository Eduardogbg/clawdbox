/**
 * Takopi Container Durable Object
 *
 * Container-enabled Durable Object that runs takopi inside Cloudflare Containers.
 */
import { Container, type StopParams } from "@cloudflare/containers";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";

import { decodeStartConfig, toContainerEnv } from "./config.js";
import type { Env, ContainerState, ContainerStatus } from "./types.js";

const SQL = {
  INIT: `
    CREATE TABLE IF NOT EXISTS takopi_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      instance_id TEXT,
      config_json TEXT,
      started_at INTEGER,
      stopped_at INTEGER,
      error TEXT
    );
    INSERT OR IGNORE INTO takopi_state (id) VALUES (1);
  `,
  GET_STATE: `
    SELECT status, instance_id, config_json, started_at, stopped_at, error
    FROM takopi_state
    WHERE id = 1
  `,
  UPDATE_STATE: `
    UPDATE takopi_state
    SET status = ?, instance_id = ?, config_json = ?, started_at = ?, stopped_at = ?, error = ?
    WHERE id = 1
  `,
};

export class TakopiContainerDO extends Container<Env> {
  private initialized = false;

  override sleepAfter = "30 minutes";

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    this.ctx.storage.sql.exec(SQL.INIT);
    this.initialized = true;
  }

  private getContainerState(): ContainerState {
    const row = this.ctx.storage.sql.exec(SQL.GET_STATE).one();
    if (!row) {
      return {
        status: "idle",
        instanceId: null,
        config: null,
        startedAt: null,
        stoppedAt: null,
        error: null,
      };
    }

    return {
      status: row.status as ContainerStatus,
      instanceId: row.instance_id as string | null,
      config: row.config_json ? JSON.parse(row.config_json as string) : null,
      startedAt: row.started_at as number | null,
      stoppedAt: row.stopped_at as number | null,
      error: row.error as string | null,
    };
  }

  private setContainerState(state: Partial<ContainerState>): void {
    const current = this.getContainerState();
    const updated = { ...current, ...state };

    this.ctx.storage.sql.exec(
      SQL.UPDATE_STATE,
      updated.status,
      updated.instanceId,
      updated.config ? JSON.stringify(updated.config) : null,
      updated.startedAt,
      updated.stoppedAt,
      updated.error,
    );
  }

  override async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const url = new URL(request.url);
    const method = request.method;

    try {
      if (url.pathname === "/status" && method === "GET") {
        return this.handleStatus();
      }

      if (url.pathname === "/start" && method === "POST") {
        return this.handleStart(request);
      }

      if (url.pathname === "/stop" && method === "POST") {
        return this.handleStop();
      }

      if (url.pathname === "/health" && method === "GET") {
        return this.handleHealth();
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Internal error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  private handleStatus(): Response {
    const state = this.getContainerState();
    return new Response(JSON.stringify(state), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleStart(request: Request): Promise<Response> {
    const state = this.getContainerState();

    if (state.status === "running" || state.status === "starting") {
      return new Response(
        JSON.stringify({
          error: "Container already running",
          instanceId: state.instanceId,
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const config = await pipe(
      Effect.tryPromise(() => request.json()),
      Effect.flatMap(decodeStartConfig),
      Effect.runPromise,
    );

    const instanceId = this.ctx.id.toString();

    this.setContainerState({
      status: "starting",
      instanceId,
      config,
      startedAt: Date.now(),
      stoppedAt: null,
      error: null,
    });

    try {
      await this.start({
        envVars: toContainerEnv(config),
      });

      this.setContainerState({ status: "running" });

      return new Response(
        JSON.stringify({
          status: "started",
          instanceId,
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      this.setContainerState({
        status: "error",
        error: error instanceof Error ? error.message : "Failed to start",
        stoppedAt: Date.now(),
      });

      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to start container",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  private async handleStop(): Promise<Response> {
    const state = this.getContainerState();

    if (state.status !== "running" && state.status !== "starting") {
      return new Response(
        JSON.stringify({
          status: "already stopped",
          previousStatus: state.status,
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    this.setContainerState({ status: "stopping" });

    try {
      await this.stop();

      this.setContainerState({
        status: "stopped",
        stoppedAt: Date.now(),
      });

      return new Response(
        JSON.stringify({
          status: "stopped",
          instanceId: state.instanceId,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      this.setContainerState({
        status: "error",
        error: error instanceof Error ? error.message : "Failed to stop",
        stoppedAt: Date.now(),
      });

      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to stop container",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  private handleHealth(): Response {
    const state = this.getContainerState();

    const health = {
      do: "healthy",
      container: state.status,
      instanceId: state.instanceId,
      startedAt: state.startedAt,
    };

    return new Response(JSON.stringify(health), {
      headers: { "Content-Type": "application/json" },
    });
  }

  override onStart(): void {
    this.setContainerState({ status: "running" });
  }

  override async onStop(params: StopParams): Promise<void> {
    if (params.exitCode === 0) {
      this.setContainerState({
        status: "stopped",
        stoppedAt: Date.now(),
      });
      return;
    }

    this.setContainerState({
      status: "error",
      error: `Container exited with code ${params.exitCode}`,
      stoppedAt: Date.now(),
    });
  }

  override onError(error: unknown): void {
    this.setContainerState({
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
      stoppedAt: Date.now(),
    });
  }
}
