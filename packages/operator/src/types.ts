/**
 * Type definitions for Operator Durable Object
 */
import * as Schema from "effect/Schema";

// Task status enum
export const TaskStatus = Schema.Literal("pending", "active", "completed", "failed");
export type TaskStatus = Schema.Schema.Type<typeof TaskStatus>;

// Session status enum
export const SessionStatus = Schema.Literal("starting", "running", "paused", "stopped");
export type SessionStatus = Schema.Schema.Type<typeof SessionStatus>;

// Permission status enum
export const PermissionStatus = Schema.Literal("pending", "approved", "denied", "expired");
export type PermissionStatus = Schema.Schema.Type<typeof PermissionStatus>;

// Task schema
export const Task = Schema.Struct({
  id: Schema.String,
  telegramTopicId: Schema.Number.pipe(Schema.optional),
  telegramChatId: Schema.Number.pipe(Schema.optional),
  status: TaskStatus,
  prompt: Schema.String,
  repoUrl: Schema.String.pipe(Schema.optional),
  branch: Schema.String.pipe(Schema.optional),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type Task = Schema.Schema.Type<typeof Task>;

// Session schema
export const Session = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  containerId: Schema.String.pipe(Schema.optional),
  claudeSessionId: Schema.String.pipe(Schema.optional),
  status: SessionStatus,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type Session = Schema.Schema.Type<typeof Session>;

// Permission request schema
export const Permission = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  toolName: Schema.String,
  toolInput: Schema.String,
  status: PermissionStatus,
  reason: Schema.String.pipe(Schema.optional),
  createdAt: Schema.Number,
  resolvedAt: Schema.Number.pipe(Schema.optional),
});
export type Permission = Schema.Schema.Type<typeof Permission>;

// API Request schemas
export const CreateTaskRequest = Schema.Struct({
  prompt: Schema.String,
  telegramTopicId: Schema.Number.pipe(Schema.optional),
  telegramChatId: Schema.Number.pipe(Schema.optional),
  repoUrl: Schema.String.pipe(Schema.optional),
  branch: Schema.String.pipe(Schema.optional),
});
export type CreateTaskRequest = Schema.Schema.Type<typeof CreateTaskRequest>;

// Spawn agent request
export const SpawnAgentRequest = Schema.Struct({
  taskId: Schema.String,
  repoUrl: Schema.String,
  branch: Schema.String.pipe(Schema.optional),
});
export type SpawnAgentRequest = Schema.Schema.Type<typeof SpawnAgentRequest>;

export const RequestPermissionRequest = Schema.Struct({
  taskId: Schema.String,
  toolUseId: Schema.String,
  toolName: Schema.String,
  toolInput: Schema.String,
});
export type RequestPermissionRequest = Schema.Schema.Type<typeof RequestPermissionRequest>;

export const ResolvePermissionRequest = Schema.Struct({
  permissionId: Schema.String,
  approved: Schema.Boolean,
  reason: Schema.String.pipe(Schema.optional),
});
export type ResolvePermissionRequest = Schema.Schema.Type<typeof ResolvePermissionRequest>;

export const StreamMessageRequest = Schema.Struct({
  taskId: Schema.String,
  text: Schema.String,
  type: Schema.Literal("text", "tool_use", "tool_result", "error").pipe(Schema.optional),
});
export type StreamMessageRequest = Schema.Schema.Type<typeof StreamMessageRequest>;
