/**
 * Type definitions for the Agent Worker
 */

import type { AgentContainerDO } from "./agent-container-do.js";

/**
 * Environment bindings for the Worker
 */
export interface Env {
  AGENT_CONTAINER: DurableObjectNamespace<AgentContainerDO>;
  // SECRETS: SecretsStore;
}

/**
 * Agent configuration passed to the container
 */
export interface AgentConfig {
  taskId: string;
  repoUrl: string;
  branch: string;
  prompt: string;
  operatorUrl: string;
  workingDirectory?: string;
  sessionId?: string; // For resuming
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
  taskId: string | null;
  config: AgentConfig | null;
  startedAt: number | null;
  stoppedAt: number | null;
  error: string | null;
}
