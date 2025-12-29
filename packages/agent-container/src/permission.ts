/**
 * Permission Hook for Claude Agent SDK
 *
 * Routes permission requests through the Operator Durable Object
 * for approval via Telegram.
 */
import * as Effect from "effect/Effect";
import type { AgentConfig } from "./config.js";

/**
 * Tool use input from the Agent SDK
 */
interface ToolUseInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

/**
 * Permission hook callback result
 */
interface HookResult {
  decision?: "block";
  reason?: string;
}

/**
 * Creates a permission hook that routes dangerous tool calls to Operator
 */
export const createPermissionHook = (config: AgentConfig) => {
  return async (
    input: ToolUseInput,
    toolUseId: string,
    _context: unknown,
  ): Promise<HookResult> => {
    const toolName = input.tool_name;
    const toolInput = input.tool_input;

    // Check auto-allow list first
    if (isAutoAllowed(toolName, toolInput)) {
      return {}; // Allow
    }

    // Request permission from Operator DO
    const response = await fetch(`${config.operatorUrl}/permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: config.taskId,
        toolUseId,
        toolName,
        toolInput: JSON.stringify(toolInput, null, 2),
      }),
    });

    if (!response.ok) {
      return {
        decision: "block",
        reason: `Failed to request permission: ${response.status}`,
      };
    }

    const result = (await response.json()) as { approved: boolean; reason?: string };

    if (result.approved) {
      return {}; // Allow
    } else {
      return {
        decision: "block",
        reason: result.reason ?? "Permission denied by user",
      };
    }
  };
};

/**
 * Check if a tool call is auto-allowed
 */
const isAutoAllowed = (
  toolName: string,
  toolInput: Record<string, unknown>,
): boolean => {
  // Read-only tools are always safe
  const readOnlyTools = [
    "Read",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "TodoRead",
    "TodoWrite",
    "LSP",
  ];
  if (readOnlyTools.includes(toolName)) {
    return true;
  }

  // Safe bash commands
  if (toolName === "Bash") {
    const command = (toolInput.command as string) ?? "";
    const safeCommands = [
      /^ls\b/,
      /^cat\b/,
      /^head\b/,
      /^tail\b/,
      /^pwd$/,
      /^git status/,
      /^git log/,
      /^git diff/,
      /^git branch/,
      /^bun run (lint|typecheck|test|check)/,
      /^npm run (lint|typecheck|test|check)/,
      /^pnpm run (lint|typecheck|test|check)/,
    ];
    return safeCommands.some((pattern) => pattern.test(command));
  }

  // Everything else needs permission
  return false;
};

/**
 * Report session ID to Operator for resume capability
 */
export const reportSessionId = (
  operatorUrl: string,
  taskId: string,
  sessionId: string,
) =>
  Effect.tryPromise({
    try: () =>
      fetch(`${operatorUrl}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, sessionId }),
      }),
    catch: (error) => new Error(`Failed to report session ID: ${error}`),
  });

/**
 * Stream output message to Operator
 */
export const streamToOperator = (
  operatorUrl: string,
  taskId: string,
  message: unknown,
) =>
  Effect.tryPromise({
    try: async () => {
      // Format message for display
      let text = "";
      const msg = message as Record<string, unknown>;

      if (msg.type === "assistant" && msg.message) {
        // Text output from Claude
        const content = (msg.message as Record<string, unknown>).content as Array<{
          type: string;
          text?: string;
        }>;
        text = content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
      } else if (msg.type === "tool_use") {
        // Tool invocation
        text = `🔧 Using ${msg.name}...`;
      } else if (msg.type === "tool_result") {
        // Tool result (truncated)
        const result = ((msg.content as string) ?? "").substring(0, 500);
        text = `✅ ${result}${result.length >= 500 ? "..." : ""}`;
      }

      if (text) {
        await fetch(`${operatorUrl}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, text }),
        });
      }
    },
    catch: (error) => new Error(`Failed to stream to operator: ${error}`),
  });

/**
 * Report task completion to Operator
 */
export const reportCompletion = (
  operatorUrl: string,
  taskId: string,
  result: unknown,
) =>
  Effect.tryPromise({
    try: () =>
      fetch(`${operatorUrl}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, result }),
      }),
    catch: (error) => new Error(`Failed to report completion: ${error}`),
  });

/**
 * Report error to Operator
 */
export const reportError = (
  operatorUrl: string,
  taskId: string,
  error: string,
) =>
  Effect.tryPromise({
    try: () =>
      fetch(`${operatorUrl}/error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, error }),
      }),
    catch: (e) => new Error(`Failed to report error: ${e}`),
  });
