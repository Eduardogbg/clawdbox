/**
 * Agent Container Entrypoint
 *
 * This is the main entry point for the Claude Agent SDK container.
 * It orchestrates:
 * 1. Configuration parsing
 * 2. Repository cloning
 * 3. Agent execution with permission hooks
 * 4. Result streaming to Operator
 */
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import { pipe } from "effect/Function";
import { LogLevel, Logger } from "effect";

import { AgentConfig, AgentEnv } from "./config.js";
import { cloneRepo, pushChanges } from "./repo.js";
import {
  createPermissionHook,
  reportCompletion,
  reportError,
  reportSessionId,
  streamToOperator,
} from "./permission.js";

/**
 * Main agent execution
 */
const main = Effect.gen(function* () {
  yield* Effect.logInfo("=== Clawdbox Agent Container Starting ===");

  // Parse environment
  const env = yield* pipe(
    Effect.try(() => ({
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
      GITHUB_PAT: process.env.GITHUB_PAT,
      AGENT_CONFIG: process.env.AGENT_CONFIG ?? "",
    })),
    Effect.flatMap(S.decodeUnknown(AgentEnv)),
    Effect.mapError((e) => new Error(`Invalid environment: ${e}`)),
  );

  // Parse configuration
  const config = yield* pipe(
    Effect.try(() => JSON.parse(env.AGENT_CONFIG)),
    Effect.flatMap(S.decodeUnknown(AgentConfig)),
    Effect.mapError((e) => new Error(`Invalid configuration: ${e}`)),
  );

  yield* Effect.logInfo(`Task ID: ${config.taskId}`);
  yield* Effect.logInfo(`Repository: ${config.repoUrl}`);
  yield* Effect.logInfo(`Branch: ${config.branch}`);

  // Clone repository
  yield* cloneRepo(config.repoUrl, config.branch);

  // Run agent
  yield* runAgent(config);

  yield* Effect.logInfo("=== Agent Container Completed ===");
});

/**
 * Run the Claude Agent SDK
 *
 * Note: The actual Agent SDK integration requires @anthropic-ai/claude-agent-sdk
 * which would be installed in the container. This is a placeholder that shows
 * the intended structure.
 */
const runAgent = (config: AgentConfig) =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Starting Claude Agent SDK...");

    // In production, this would use the actual Agent SDK:
    // import { query } from "@anthropic-ai/claude-agent-sdk";

    // For now, we'll simulate the agent behavior
    yield* Effect.logInfo("Agent SDK would be invoked here with:");
    yield* Effect.logInfo(`  Prompt: ${config.prompt}`);
    yield* Effect.logInfo(`  Working Directory: ${config.workingDirectory ?? "/workspace"}`);
    yield* Effect.logInfo(`  Session ID: ${config.sessionId ?? "new session"}`);

    // The actual implementation would look like:
    /*
    const options = {
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      permissionMode: "default" as const,
      workingDirectory: config.workingDirectory ?? "/workspace",
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash|Write|Edit",
            hooks: [createPermissionHook(config)],
          },
        ],
      },
      ...(config.sessionId ? { resume: config.sessionId } : {}),
    };

    let sessionId: string | undefined;

    for await (const message of query({
      prompt: config.prompt,
      options,
    })) {
      // Capture session ID for resume capability
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        yield* reportSessionId(config.operatorUrl, config.taskId, sessionId);
      }

      // Stream output to Operator DO
      yield* streamToOperator(config.operatorUrl, config.taskId, message);

      // Handle completion
      if ("result" in message) {
        yield* reportCompletion(config.operatorUrl, config.taskId, message.result);
      }
    }
    */

    // Placeholder: Report completion
    yield* reportCompletion(config.operatorUrl, config.taskId, {
      status: "completed",
      message: "Agent execution simulated successfully",
    });
  });

/**
 * Error recovery wrapper
 */
const runWithRecovery = pipe(
  main,
  Effect.catchAll((error) =>
    Effect.gen(function* () {
      yield* Effect.logError(`Agent failed: ${error}`);

      // Try to report error to operator
      const configStr = process.env.AGENT_CONFIG;
      if (configStr) {
        try {
          const config = JSON.parse(configStr) as AgentConfig;
          yield* reportError(
            config.operatorUrl,
            config.taskId,
            `${error}`,
          );
        } catch {
          yield* Effect.logError("Could not report error to operator");
        }
      }

      return yield* Effect.fail(error);
    }),
  ),
  Logger.withMinimumLogLevel(LogLevel.Info),
);

// Run the agent
Effect.runPromise(runWithRecovery).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
