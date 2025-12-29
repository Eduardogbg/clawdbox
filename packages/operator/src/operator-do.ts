/**
 * Operator Durable Object
 *
 * Central coordinator for agent orchestration.
 * Manages tasks, sessions, and permission requests.
 */
import { DurableObject } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { pipe } from "effect/Function";
import type { Task, Session, Permission, TaskStatus, SessionStatus } from "./types.js";
import * as SQL from "./sql.js";

// Generate unique IDs
function generateId(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

/**
 * Helper to get first row from SQL cursor
 */
function getOne<T>(cursor: { one(): T | null }): T | null {
  return cursor.one();
}

/**
 * Environment bindings for the Worker
 */
export interface Env {
  OPERATOR: DurableObjectNamespace<OperatorDO>;
  // Future bindings:
  // SECRETS: SecretsStore;
  // STORAGE: R2Bucket;
  // AGENT_CONTAINER: DurableObjectNamespace;
}

/**
 * Map a SQL row to a Task object
 */
function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    telegramTopicId: row.telegram_topic_id as number | undefined,
    telegramChatId: row.telegram_chat_id as number | undefined,
    status: row.status as TaskStatus,
    prompt: row.prompt as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/**
 * Map a SQL row to a Session object
 */
function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    containerId: row.container_id as string | undefined,
    claudeSessionId: row.claude_session_id as string | undefined,
    status: row.status as SessionStatus,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/**
 * Map a SQL row to a Permission object
 */
function rowToPermission(row: Record<string, unknown>): Permission {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    toolName: row.tool_name as string,
    toolInput: row.tool_input as string,
    status: row.status as Permission["status"],
    reason: row.reason as string | undefined,
    createdAt: row.created_at as number,
    resolvedAt: row.resolved_at as number | undefined,
  };
}

/**
 * Operator Durable Object - manages agent state and coordination
 */
export class OperatorDO extends DurableObject<Env> {
  private initialized = false;

  /**
   * Initialize the database schema
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      this.ctx.storage.sql.exec(SQL.INIT_SCHEMA);
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize schema:", error);
      throw error;
    }
  }

  /**
   * Handle incoming fetch requests
   */
  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const url = new URL(request.url);
    const method = request.method;

    try {
      // Route handling
      if (url.pathname === "/health" && method === "GET") {
        return this.handleHealth();
      }

      if (url.pathname === "/tasks" && method === "POST") {
        return this.handleCreateTask(request);
      }

      if (url.pathname === "/tasks" && method === "GET") {
        return this.handleListTasks(url);
      }

      if (url.pathname.match(/^\/tasks\/[^/]+$/) && method === "GET") {
        const id = url.pathname.split("/")[2];
        return this.handleGetTask(id);
      }

      if (url.pathname.match(/^\/tasks\/[^/]+\/status$/) && method === "PATCH") {
        const id = url.pathname.split("/")[2];
        return this.handleUpdateTaskStatus(id, request);
      }

      if (url.pathname === "/sessions" && method === "POST") {
        return this.handleCreateSession(request);
      }

      if (url.pathname.match(/^\/sessions\/[^/]+$/) && method === "GET") {
        const id = url.pathname.split("/")[2];
        return this.handleGetSession(id);
      }

      if (url.pathname === "/permissions" && method === "POST") {
        return this.handleRequestPermission(request);
      }

      if (url.pathname.match(/^\/permissions\/[^/]+$/) && method === "GET") {
        const id = url.pathname.split("/")[2];
        return this.handleGetPermission(id);
      }

      if (url.pathname.match(/^\/permissions\/[^/]+\/resolve$/) && method === "POST") {
        const id = url.pathname.split("/")[2];
        return this.handleResolvePermission(id, request);
      }

      if (url.pathname === "/stream" && method === "POST") {
        return this.handleStreamMessage(request);
      }

      // Agent reporting endpoints
      if (url.pathname === "/session" && method === "POST") {
        return this.handleReportSession(request);
      }

      if (url.pathname === "/complete" && method === "POST") {
        return this.handleReportComplete(request);
      }

      if (url.pathname === "/error" && method === "POST") {
        return this.handleReportError(request);
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
   * Health check endpoint
   */
  private handleHealth(): Response {
    return new Response(
      JSON.stringify({
        status: "ok",
        initialized: this.initialized,
        timestamp: now(),
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  /**
   * Create a new task
   */
  private async handleCreateTask(request: Request): Promise<Response> {
    const body = await request.json();
    const { prompt, telegramTopicId, telegramChatId } = body as {
      prompt: string;
      telegramTopicId?: number;
      telegramChatId?: number;
    };

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const task: Task = {
      id: generateId(),
      telegramTopicId,
      telegramChatId,
      status: "pending",
      prompt,
      createdAt: now(),
      updatedAt: now(),
    };

    this.ctx.storage.sql.exec(
      SQL.INSERT_TASK,
      task.id,
      task.telegramTopicId ?? null,
      task.telegramChatId ?? null,
      task.status,
      task.prompt,
      task.createdAt,
      task.updatedAt
    );

    return new Response(JSON.stringify(task), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * List tasks with optional status filter
   */
  private handleListTasks(url: URL): Response {
    const status = url.searchParams.get("status");
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);

    const cursor = status
      ? this.ctx.storage.sql.exec(SQL.GET_TASKS_BY_STATUS, status)
      : this.ctx.storage.sql.exec(SQL.GET_ALL_TASKS, limit);

    const tasks = cursor.toArray().map(rowToTask);

    return new Response(JSON.stringify({ tasks }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Get a specific task
   */
  private handleGetTask(id: string): Response {
    const row = this.ctx.storage.sql.exec(SQL.GET_TASK, id).one();

    if (!row) {
      return new Response(JSON.stringify({ error: "Task not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const task = rowToTask(row);

    return new Response(JSON.stringify(task), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Update task status
   */
  private async handleUpdateTaskStatus(id: string, request: Request): Promise<Response> {
    const body = await request.json();
    const { status } = body as { status: TaskStatus };

    if (!status) {
      return new Response(JSON.stringify({ error: "status is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    this.ctx.storage.sql.exec(SQL.UPDATE_TASK_STATUS, status, now(), id);

    // Fetch updated task
    const row = this.ctx.storage.sql.exec(SQL.GET_TASK, id).one();

    if (!row) {
      return new Response(JSON.stringify({ error: "Task not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const task = rowToTask(row);

    return new Response(JSON.stringify(task), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Create a new session for a task
   */
  private async handleCreateSession(request: Request): Promise<Response> {
    const body = await request.json();
    const { taskId, containerId, claudeSessionId } = body as {
      taskId: string;
      containerId?: string;
      claudeSessionId?: string;
    };

    if (!taskId) {
      return new Response(JSON.stringify({ error: "taskId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify task exists
    const taskRow = this.ctx.storage.sql.exec(SQL.GET_TASK, taskId).one();
    if (!taskRow) {
      return new Response(JSON.stringify({ error: "Task not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const session: Session = {
      id: generateId(),
      taskId,
      containerId,
      claudeSessionId,
      status: "starting",
      createdAt: now(),
      updatedAt: now(),
    };

    this.ctx.storage.sql.exec(
      SQL.INSERT_SESSION,
      session.id,
      session.taskId,
      session.containerId ?? null,
      session.claudeSessionId ?? null,
      session.status,
      session.createdAt,
      session.updatedAt
    );

    // Update task status to active
    this.ctx.storage.sql.exec(SQL.UPDATE_TASK_STATUS, "active", now(), taskId);

    return new Response(JSON.stringify(session), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Get a specific session
   */
  private handleGetSession(id: string): Response {
    const row = this.ctx.storage.sql.exec(SQL.GET_SESSION, id).one();

    if (!row) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const session = rowToSession(row);

    return new Response(JSON.stringify(session), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Request permission for a tool use
   */
  private async handleRequestPermission(request: Request): Promise<Response> {
    const body = await request.json();
    const { taskId, toolUseId, toolName, toolInput } = body as {
      taskId: string;
      toolUseId: string;
      toolName: string;
      toolInput: string;
    };

    if (!taskId || !toolUseId || !toolName || !toolInput) {
      return new Response(
        JSON.stringify({ error: "taskId, toolUseId, toolName, and toolInput are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get the session for this task
    const sessionRow = this.ctx.storage.sql.exec(SQL.GET_SESSION_BY_TASK, taskId).one();
    if (!sessionRow) {
      return new Response(JSON.stringify({ error: "Session not found for task" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const session = rowToSession(sessionRow);

    const permission: Permission = {
      id: toolUseId, // Use toolUseId as the permission ID for correlation
      sessionId: session.id,
      toolName,
      toolInput,
      status: "pending",
      createdAt: now(),
    };

    this.ctx.storage.sql.exec(
      SQL.INSERT_PERMISSION,
      permission.id,
      permission.sessionId,
      permission.toolName,
      permission.toolInput,
      permission.status,
      permission.createdAt
    );

    return new Response(JSON.stringify(permission), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Get a specific permission
   */
  private handleGetPermission(id: string): Response {
    const row = this.ctx.storage.sql.exec(SQL.GET_PERMISSION, id).one();

    if (!row) {
      return new Response(JSON.stringify({ error: "Permission not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const permission = rowToPermission(row);

    return new Response(JSON.stringify(permission), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Resolve a pending permission request
   */
  private async handleResolvePermission(id: string, request: Request): Promise<Response> {
    const body = await request.json();
    const { approved, reason } = body as { approved: boolean; reason?: string };

    if (typeof approved !== "boolean") {
      return new Response(JSON.stringify({ error: "approved is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get current permission
    const row = this.ctx.storage.sql.exec(SQL.GET_PERMISSION, id).one();
    if (!row) {
      return new Response(JSON.stringify({ error: "Permission not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const currentPermission = rowToPermission(row);
    if (currentPermission.status !== "pending") {
      return new Response(JSON.stringify({ error: "Permission already resolved" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    const newStatus = approved ? "approved" : "denied";
    this.ctx.storage.sql.exec(SQL.UPDATE_PERMISSION, newStatus, reason ?? null, now(), id);

    // Fetch updated permission
    const updatedRow = this.ctx.storage.sql.exec(SQL.GET_PERMISSION, id).one();
    const permission = rowToPermission(updatedRow!);

    return new Response(JSON.stringify(permission), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Handle streaming messages from agent (placeholder for future WebSocket support)
   */
  private async handleStreamMessage(request: Request): Promise<Response> {
    const body = await request.json();
    const { taskId, text, type } = body as {
      taskId: string;
      text: string;
      type?: string;
    };

    if (!taskId || !text) {
      return new Response(JSON.stringify({ error: "taskId and text are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // TODO: In the future, forward this to connected WebSocket clients
    // For now, just log it
    console.log(`[Stream][${taskId}][${type ?? "text"}]: ${text.substring(0, 100)}`);

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Handle session ID report from agent (for resume capability)
   */
  private async handleReportSession(request: Request): Promise<Response> {
    const body = await request.json();
    const { taskId, sessionId } = body as {
      taskId: string;
      sessionId: string;
    };

    if (!taskId || !sessionId) {
      return new Response(JSON.stringify({ error: "taskId and sessionId are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Update the session with the Claude session ID
    this.ctx.storage.sql.exec(SQL.UPDATE_SESSION_BY_TASK, sessionId, now(), taskId);

    // Also update session status to running
    this.ctx.storage.sql.exec(SQL.UPDATE_SESSION_STATUS_BY_TASK, "running", now(), taskId);

    console.log(`[Session][${taskId}]: Claude session ID: ${sessionId}`);

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Handle task completion report from agent
   */
  private async handleReportComplete(request: Request): Promise<Response> {
    const body = await request.json();
    const { taskId, result } = body as {
      taskId: string;
      result: unknown;
    };

    if (!taskId) {
      return new Response(JSON.stringify({ error: "taskId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Update task status to completed
    this.ctx.storage.sql.exec(SQL.UPDATE_TASK_STATUS, "completed", now(), taskId);

    // Update session status to stopped
    this.ctx.storage.sql.exec(SQL.UPDATE_SESSION_STATUS_BY_TASK, "stopped", now(), taskId);

    console.log(`[Complete][${taskId}]: Task completed`, result);

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Handle error report from agent
   */
  private async handleReportError(request: Request): Promise<Response> {
    const body = await request.json();
    const { taskId, error } = body as {
      taskId: string;
      error: string;
    };

    if (!taskId) {
      return new Response(JSON.stringify({ error: "taskId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Update task status to failed
    this.ctx.storage.sql.exec(SQL.UPDATE_TASK_STATUS, "failed", now(), taskId);

    // Update session status to stopped
    this.ctx.storage.sql.exec(SQL.UPDATE_SESSION_STATUS_BY_TASK, "stopped", now(), taskId);

    console.error(`[Error][${taskId}]: ${error}`);

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
