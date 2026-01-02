/**
 * Type definitions for the Takopi Worker
 */

import type { TakopiContainerDO } from "./takopi-container-do.js";

/**
 * Environment bindings for the Worker
 */
export interface Env {
  TAKOPI_CONTAINER: DurableObjectNamespace<TakopiContainerDO>;
  // SECRETS: SecretsStore;
}

/**
 * Takopi start configuration passed to the container
 */
export interface TakopiStartConfig {
  botToken: string;
  chatId: number;
  repoUrl: string;
  repoBranch?: string;
  workdir?: string;
  openAiApiKey?: string;
  codexProfile?: string;
  codexConfigToml?: string;
  codexArgs?: string;
  logServer?: boolean;
  allowGroup?: boolean;
  deleteWebhook?: boolean;
  stripCommands?: boolean;
  finalNotify?: boolean;
  debug?: boolean;
  githubPat?: string;
}

export interface TakopiStoredConfig {
  chatId: number;
  repoUrl: string;
  repoBranch?: string;
  workdir?: string;
  codexProfile?: string;
  codexArgs?: string;
  logServer?: boolean;
  allowGroup?: boolean;
  deleteWebhook?: boolean;
  stripCommands?: boolean;
  finalNotify?: boolean;
  debug?: boolean;
  hasBotToken: boolean;
  hasOpenAiApiKey: boolean;
  hasGithubPat: boolean;
  hasCodexConfigToml: boolean;
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
  config: TakopiStoredConfig | null;
  startedAt: number | null;
  stoppedAt: number | null;
  error: string | null;
}
