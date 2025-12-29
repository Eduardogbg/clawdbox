/**
 * Operator Durable Object Client
 *
 * Client for communicating with the Operator Durable Object.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Task creation response
 */
export const TaskResponse = Schema.Struct({
  id: Schema.String,
  telegramTopicId: Schema.optional(Schema.Number),
  telegramChatId: Schema.optional(Schema.Number),
  status: Schema.Literal("pending", "active", "completed", "failed"),
  prompt: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type TaskResponse = Schema.Schema.Type<typeof TaskResponse>;

/**
 * Session response
 */
export const SessionResponse = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  containerId: Schema.optional(Schema.String),
  claudeSessionId: Schema.optional(Schema.String),
  status: Schema.Literal("starting", "running", "paused", "stopped"),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type SessionResponse = Schema.Schema.Type<typeof SessionResponse>;

/**
 * Permission response
 */
export const PermissionResponse = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  toolName: Schema.String,
  toolInput: Schema.String,
  status: Schema.Literal("pending", "approved", "denied", "expired"),
  reason: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  resolvedAt: Schema.optional(Schema.Number),
});
export type PermissionResponse = Schema.Schema.Type<typeof PermissionResponse>;

/**
 * Create an Operator client
 */
export const createOperatorClient = (operatorUrl: string) => ({
  /**
   * Create a new task
   */
  createTask: (params: {
    prompt: string;
    telegramTopicId?: number;
    telegramChatId?: number;
  }) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${operatorUrl}/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          }),
        catch: (e) => new Error(`Failed to create task: ${e}`),
      });

      if (!response.ok) {
        const text = yield* Effect.tryPromise(() => response.text());
        return yield* Effect.fail(
          new Error(`Failed to create task: ${response.status} ${text}`),
        );
      }

      const json = yield* Effect.tryPromise(() => response.json());
      return yield* Schema.decodeUnknown(TaskResponse)(json);
    }),

  /**
   * Get a task by ID
   */
  getTask: (taskId: string) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch(`${operatorUrl}/tasks/${taskId}`),
        catch: (e) => new Error(`Failed to get task: ${e}`),
      });

      if (!response.ok) {
        return yield* Effect.fail(
          new Error(`Failed to get task: ${response.status}`),
        );
      }

      const json = yield* Effect.tryPromise(() => response.json());
      return yield* Schema.decodeUnknown(TaskResponse)(json);
    }),

  /**
   * List tasks
   */
  listTasks: (params?: { status?: string; limit?: number }) =>
    Effect.gen(function* () {
      const url = new URL(`${operatorUrl}/tasks`);
      if (params?.status) url.searchParams.set("status", params.status);
      if (params?.limit) url.searchParams.set("limit", String(params.limit));

      const response = yield* Effect.tryPromise({
        try: () => fetch(url.toString()),
        catch: (e) => new Error(`Failed to list tasks: ${e}`),
      });

      if (!response.ok) {
        return yield* Effect.fail(
          new Error(`Failed to list tasks: ${response.status}`),
        );
      }

      const json = yield* Effect.tryPromise(() => response.json());
      const data = json as { tasks: unknown[] };
      const tasks = yield* Effect.forEach(data.tasks, (t) =>
        Schema.decodeUnknown(TaskResponse)(t),
      );
      return tasks;
    }),

  /**
   * Create a session for a task
   */
  createSession: (params: {
    taskId: string;
    containerId?: string;
    claudeSessionId?: string;
  }) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${operatorUrl}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          }),
        catch: (e) => new Error(`Failed to create session: ${e}`),
      });

      if (!response.ok) {
        const text = yield* Effect.tryPromise(() => response.text());
        return yield* Effect.fail(
          new Error(`Failed to create session: ${response.status} ${text}`),
        );
      }

      const json = yield* Effect.tryPromise(() => response.json());
      return yield* Schema.decodeUnknown(SessionResponse)(json);
    }),

  /**
   * Resolve a permission request
   */
  resolvePermission: (
    permissionId: string,
    params: { approved: boolean; reason?: string },
  ) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${operatorUrl}/permissions/${permissionId}/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          }),
        catch: (e) => new Error(`Failed to resolve permission: ${e}`),
      });

      if (!response.ok) {
        const text = yield* Effect.tryPromise(() => response.text());
        return yield* Effect.fail(
          new Error(`Failed to resolve permission: ${response.status} ${text}`),
        );
      }

      const json = yield* Effect.tryPromise(() => response.json());
      return yield* Schema.decodeUnknown(PermissionResponse)(json);
    }),

  /**
   * Send a stream message (for agent output)
   */
  sendStreamMessage: (params: {
    taskId: string;
    text: string;
    type?: "text" | "tool_use" | "tool_result" | "error";
  }) =>
    Effect.tryPromise({
      try: () =>
        fetch(`${operatorUrl}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        }),
      catch: (e) => new Error(`Failed to send stream message: ${e}`),
    }),

  /**
   * Get pending permissions for a task
   */
  getTaskPermissions: (taskId: string) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch(`${operatorUrl}/tasks/${taskId}/permissions`),
        catch: (e) => new Error(`Failed to get task permissions: ${e}`),
      });

      if (!response.ok) {
        return yield* Effect.fail(
          new Error(`Failed to get task permissions: ${response.status}`),
        );
      }

      const json = yield* Effect.tryPromise(() => response.json());
      const data = json as { permissions: unknown[]; taskId: string; sessionId?: string };
      const permissions = yield* Effect.forEach(data.permissions, (p) =>
        Schema.decodeUnknown(PermissionResponse)(p),
      );
      return { permissions, taskId: data.taskId, sessionId: data.sessionId };
    }),

  /**
   * Update task status
   */
  updateTaskStatus: (taskId: string, status: TaskResponse["status"]) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${operatorUrl}/tasks/${taskId}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          }),
        catch: (e) => new Error(`Failed to update task status: ${e}`),
      });

      if (!response.ok) {
        const text = yield* Effect.tryPromise(() => response.text());
        return yield* Effect.fail(
          new Error(`Failed to update task status: ${response.status} ${text}`),
        );
      }

      const json = yield* Effect.tryPromise(() => response.json());
      return yield* Schema.decodeUnknown(TaskResponse)(json);
    }),
});

export type OperatorClient = ReturnType<typeof createOperatorClient>;
