/**
 * Agent Configuration Schema
 *
 * Configuration is passed via AGENT_CONFIG environment variable as JSON.
 */
import * as S from "effect/Schema";

/**
 * Configuration schema for agent tasks
 */
export const AgentConfig = S.Struct({
  /** Unique task identifier */
  taskId: S.String,

  /** The prompt/task to execute */
  prompt: S.String,

  /** Git repository URL (from R2 or direct GitHub) */
  repoUrl: S.String,

  /** Branch to work on */
  branch: S.String,

  /** Operator Durable Object URL for callbacks */
  operatorUrl: S.String,

  /** Optional session ID for resuming previous sessions */
  sessionId: S.optional(S.String),

  /** Optional working directory within the workspace */
  workingDirectory: S.optional(S.String),
});

export type AgentConfig = S.Schema.Type<typeof AgentConfig>;

/**
 * Environment variables required by the agent
 */
export const AgentEnv = S.Struct({
  /** Anthropic API key for Claude */
  ANTHROPIC_API_KEY: S.String,

  /** GitHub PAT for repository access (optional for private repos) */
  GITHUB_PAT: S.optional(S.String),

  /** Agent configuration as JSON */
  AGENT_CONFIG: S.String,
});

export type AgentEnv = S.Schema.Type<typeof AgentEnv>;
