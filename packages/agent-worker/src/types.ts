/**
 * Type definitions for the Agent Worker
 */
import type { AgentContainerDO } from "./agent-container-do.js";
import type { OrchestratorDO } from "./orchestrator-do.js";

/**
 * Environment bindings for the Worker
 */
export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  CODEX_API_KEY?: string;
  OPENAI_API_KEY?: string;
  CODEX_ARGS?: string;
  CODEX_PROFILE?: string;
  CONTAINER_WORKDIR?: string;
  CONTAINER_REPO_URL?: string;
  CONTAINER_REPO_BRANCH?: string;
  MAX_QUEUE_SIZE?: string;
  PROGRESS_EDIT_MS?: string;
  ORCHESTRATOR: DurableObjectNamespace<OrchestratorDO>;
  AGENT_CONTAINER: DurableObjectNamespace<AgentContainerDO>;
}

/**
 * Container status
 */
export type ContainerStatus =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

/**
 * Container state stored in the DO
 */
export interface ContainerState {
  status: ContainerStatus;
  instanceId: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  error: string | null;
}

export interface ChatState {
  sessionId: string | null;
  sessionEpoch: number;
  activeRun: number;
  updatedAt: number | null;
}

export interface QueueItem {
  id: number;
  messageId: number;
  text: string;
  createdAt: number;
}

export interface RunRequest {
  prompt: string;
  sessionId?: string | null;
  workdir?: string;
}
