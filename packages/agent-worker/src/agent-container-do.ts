/**
 * Agent Container Durable Object
 *
 * A container-enabled Durable Object that runs Claude agent containers.
 * Extends the Container base class from @cloudflare/containers.
 */
import { Container, type StopParams } from "@cloudflare/containers";
import type { Env, AgentConfig, ContainerState, ContainerStatus } from "./types.js";

/**
 * SQL statements for container state management
 */
const SQL = {
  INIT: `
    CREATE TABLE IF NOT EXISTS agent_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      task_id TEXT,
      config_json TEXT,
      started_at INTEGER,
      stopped_at INTEGER,
      error TEXT
    );
    INSERT OR IGNORE INTO agent_state (id) VALUES (1);
  `,

  GET_STATE: `
    SELECT status, task_id, config_json, started_at, stopped_at, error
    FROM agent_state
    WHERE id = 1
  `,

  UPDATE_STATE: `
    UPDATE agent_state
    SET status = ?, task_id = ?, config_json = ?, started_at = ?, stopped_at = ?, error = ?
    WHERE id = 1
  `,
};

/**
 * AgentContainerDO - Controls a Claude agent container instance.
 *
 * This DO extends the Container base class, which provides:
 * - `start()` - Start the container
 * - `stop()` - Stop the container
 * - `onStart()`, `onStop()`, `onError()` - Lifecycle callbacks
 *
 * The container runs the code from the Dockerfile specified in wrangler.toml.
 */
export class AgentContainerDO extends Container<Env> {
  private initialized = false;

  // Container configuration
  override sleepAfter = "1h"; // Keep container alive for 1 hour of inactivity

  /**
   * Initialize the database schema
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      this.ctx.storage.sql.exec(SQL.INIT);
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize schema:", error);
      throw error;
    }
  }

  /**
   * Get current container state from SQLite
   */
  private getAgentState(): ContainerState {
    const row = this.ctx.storage.sql.exec(SQL.GET_STATE).one();
    if (!row) {
      return {
        status: "idle",
        taskId: null,
        config: null,
        startedAt: null,
        stoppedAt: null,
        error: null,
      };
    }

    return {
      status: row.status as ContainerStatus,
      taskId: row.task_id as string | null,
      config: row.config_json ? JSON.parse(row.config_json as string) : null,
      startedAt: row.started_at as number | null,
      stoppedAt: row.stopped_at as number | null,
      error: row.error as string | null,
    };
  }

  /**
   * Update container state in SQLite
   */
  private setAgentState(state: Partial<ContainerState>): void {
    const current = this.getAgentState();
    const updated = { ...current, ...state };

    this.ctx.storage.sql.exec(
      SQL.UPDATE_STATE,
      updated.status,
      updated.taskId,
      updated.config ? JSON.stringify(updated.config) : null,
      updated.startedAt,
      updated.stoppedAt,
      updated.error
    );
  }

  /**
   * Handle incoming HTTP requests
   */
  override async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const url = new URL(request.url);
    const method = request.method;

    try {
      // Status endpoint
      if (url.pathname === "/status" && method === "GET") {
        return this.handleStatus();
      }

      // Start container with config
      if (url.pathname === "/start" && method === "POST") {
        return this.handleStart(request);
      }

      // Stop container
      if (url.pathname === "/stop" && method === "POST") {
        return this.handleStop();
      }

      // Health check
      if (url.pathname === "/health" && method === "GET") {
        return this.handleHealth();
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Request error:", error);
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  /**
   * Get container status
   */
  private handleStatus(): Response {
    const state = this.getAgentState();

    return new Response(JSON.stringify(state), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Start the container with agent configuration
   */
  private async handleStart(request: Request): Promise<Response> {
    const state = this.getAgentState();

    // Check if already running
    if (state.status === "running" || state.status === "starting") {
      return new Response(
        JSON.stringify({
          error: "Container already running",
          taskId: state.taskId,
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Parse configuration
    const config: AgentConfig = await request.json();

    if (!config.taskId || !config.repoUrl || !config.prompt || !config.operatorUrl) {
      return new Response(
        JSON.stringify({
          error: "Missing required config: taskId, repoUrl, prompt, operatorUrl",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Update state to starting
    this.setAgentState({
      status: "starting",
      taskId: config.taskId,
      config,
      startedAt: Date.now(),
      stoppedAt: null,
      error: null,
    });

    try {
      // Start the container with environment variables
      await this.start({
        envVars: {
          AGENT_CONFIG: JSON.stringify(config),
          // ANTHROPIC_API_KEY will be provided via secrets binding
        },
      });

      // Update state to running
      this.setAgentState({ status: "running" });

      console.log(`[Container] Started for task: ${config.taskId}`);

      return new Response(
        JSON.stringify({
          status: "started",
          taskId: config.taskId,
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      // Update state to error
      this.setAgentState({
        status: "error",
        error: error instanceof Error ? error.message : "Failed to start",
        stoppedAt: Date.now(),
      });

      console.error(`[Container] Failed to start for task: ${config.taskId}`, error);

      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to start container",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  /**
   * Stop the container
   */
  private async handleStop(): Promise<Response> {
    const state = this.getAgentState();

    if (state.status !== "running" && state.status !== "starting") {
      return new Response(
        JSON.stringify({
          status: "already stopped",
          previousStatus: state.status,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Update state to stopping
    this.setAgentState({ status: "stopping" });

    try {
      await this.stop();

      this.setAgentState({
        status: "stopped",
        stoppedAt: Date.now(),
      });

      console.log(`[Container] Stopped for task: ${state.taskId}`);

      return new Response(
        JSON.stringify({
          status: "stopped",
          taskId: state.taskId,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      this.setAgentState({
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
        }
      );
    }
  }

  /**
   * Health check
   */
  private handleHealth(): Response {
    const state = this.getAgentState();

    const health = {
      do: "healthy",
      container: state.status,
      taskId: state.taskId,
      startedAt: state.startedAt,
    };

    return new Response(JSON.stringify(health), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Lifecycle callback: container started successfully
   */
  override onStart(): void {
    console.log("[Container] Container started");
    this.setAgentState({ status: "running" });
  }

  /**
   * Lifecycle callback: container stopped
   */
  override async onStop(params: StopParams): Promise<void> {
    const state = this.getAgentState();

    console.log(`[Container] Stopped with exit code ${params.exitCode} for task: ${state.taskId}`);

    if (params.exitCode === 0) {
      this.setAgentState({
        status: "stopped",
        stoppedAt: Date.now(),
      });
    } else {
      this.setAgentState({
        status: "error",
        error: `Container exited with code ${params.exitCode}`,
        stoppedAt: Date.now(),
      });
    }

    // Notify operator if configured
    if (state.config?.operatorUrl) {
      try {
        await fetch(`${state.config.operatorUrl}/container-stopped`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: state.taskId,
            exitCode: params.exitCode,
          }),
        });
      } catch (error) {
        console.error("[Container] Failed to notify operator:", error);
      }
    }
  }

  /**
   * Lifecycle callback: container error
   */
  override onError(error: unknown): void {
    console.error("[Container] Error:", error);
    this.setAgentState({
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
      stoppedAt: Date.now(),
    });
  }
}
