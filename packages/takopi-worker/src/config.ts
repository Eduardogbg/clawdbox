/**
 * Configuration schema for Takopi container startup.
 */
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as S from "effect/Schema";

import type { TakopiStartConfig } from "./types.js";

const Bool = S.Boolean;
const DEFAULT_BRANCH = "main";
const DEFAULT_WORKDIR = "/workspace/repo";

export const TakopiStartConfigSchema = S.Struct({
  botToken: S.String,
  chatId: S.Number,
  repoUrl: S.String,
  repoBranch: S.optional(S.String),
  workdir: S.optional(S.String),
  openAiApiKey: S.optional(S.String),
  codexProfile: S.optional(S.String),
  codexConfigToml: S.optional(S.String),
  finalNotify: S.optional(Bool),
  debug: S.optional(Bool),
  githubPat: S.optional(S.String),
});

export const decodeStartConfig = (
  input: unknown,
): Effect.Effect<TakopiStartConfig, Error> =>
  pipe(
    Effect.succeed(input),
    Effect.flatMap(S.decodeUnknown(TakopiStartConfigSchema)),
    Effect.mapError((error) => new Error(`Invalid config: ${error}`)),
  );

export const toContainerEnv = (config: TakopiStartConfig): Record<string, string> => {
  const envVars: Record<string, string> = {
    TAKOPI_BOT_TOKEN: config.botToken,
    TAKOPI_CHAT_ID: String(config.chatId),
    TAKOPI_REPO_URL: config.repoUrl,
    TAKOPI_REPO_BRANCH: config.repoBranch ?? DEFAULT_BRANCH,
    TAKOPI_WORKDIR: config.workdir ?? DEFAULT_WORKDIR,
    TAKOPI_FINAL_NOTIFY: config.finalNotify === false ? "false" : "true",
    TAKOPI_DEBUG: config.debug ? "true" : "false",
  };

  if (config.openAiApiKey) {
    envVars.OPENAI_API_KEY = config.openAiApiKey;
  }

  if (config.codexProfile) {
    envVars.CODEX_PROFILE = config.codexProfile;
  }

  if (config.codexConfigToml) {
    envVars.TAKOPI_CODEX_CONFIG_TOML = config.codexConfigToml;
  }

  if (config.githubPat) {
    envVars.GITHUB_PAT = config.githubPat;
  }

  return envVars;
};
