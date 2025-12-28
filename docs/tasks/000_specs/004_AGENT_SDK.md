# Claude Agent SDK Integration

> Running Claude Agent SDK inside Cloudflare Containers

## Overview

The [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) (`@anthropic-ai/claude-agent-sdk`) provides the same tools and agent loop that power Claude Code, programmable in TypeScript. Clawdbox runs agents inside Cloudflare Containers with full filesystem access.

## SDK Capabilities

### Built-in Tools

| Tool | Description | Auto-Allow? |
|------|-------------|-------------|
| Read | Read any file | Yes |
| Write | Create new files | No |
| Edit | Modify existing files | No |
| Bash | Run terminal commands | No |
| Glob | Find files by pattern | Yes |
| Grep | Search file contents | Yes |
| WebSearch | Search the web | Yes |
| WebFetch | Fetch web content | Yes |
| TodoRead | Read todo list | Yes |
| TodoWrite | Write todo list | Yes |

### Key Features

- **Sessions**: Persist context across multiple exchanges
- **Subagents**: Spawn specialized agents for subtasks
- **Hooks**: Custom code at lifecycle points
- **MCP**: Connect external tools via Model Context Protocol
- **Streaming**: Real-time response streaming

## Container Setup

### Dockerfile

```dockerfile
FROM oven/bun:latest

# System dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (required for claude-code CLI)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install claude-code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Install bun packages for agent runtime
WORKDIR /agent
COPY package.json bun.lockb ./
RUN bun install

# Copy agent source
COPY src/ ./src/

# Workspace for cloned repos
RUN mkdir -p /workspace

ENTRYPOINT ["bun", "run", "src/entrypoint.ts"]
```

### Entrypoint Script

```typescript
// src/entrypoint.ts
import { Effect, pipe } from "effect";
import { query } from "@anthropic-ai/claude-agent-sdk";

interface AgentConfig {
  taskId: string;
  prompt: string;
  repoUrl: string;
  branch: string;
  operatorUrl: string;
  sessionId?: string; // For resume
}

const main = Effect.gen(function* () {
  // Parse config from environment
  const config: AgentConfig = JSON.parse(process.env.AGENT_CONFIG!);

  // Clone repo from R2 (pre-downloaded by entrypoint)
  yield* cloneRepo(config.repoUrl, config.branch);

  // Run agent
  yield* runAgent(config);
});

const runAgent = (config: AgentConfig) =>
  Effect.gen(function* () {
    const options = {
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      permissionMode: "default" as const,
      workingDirectory: "/workspace",
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
  });

Effect.runPromise(main);
```

## Permission Hook

The permission hook intercepts tool calls and routes them to Telegram for approval:

```typescript
// src/hooks/permission.ts
import { Effect } from "effect";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

const createPermissionHook = (config: AgentConfig): HookCallback => {
  return async (input, toolUseId, context) => {
    const toolName = (input as any).tool_name;
    const toolInput = (input as any).tool_input;

    // Check auto-allow list
    if (isAutoAllowed(toolName, toolInput)) {
      return {}; // Allow
    }

    // Request permission from Operator
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

    const result = await response.json();

    if (result.approved) {
      return {}; // Allow
    } else {
      return {
        decision: "block",
        reason: result.reason || "Permission denied by user",
      };
    }
  };
};

const isAutoAllowed = (toolName: string, toolInput: any): boolean => {
  // Auto-allow read-only tools
  const readOnlyTools = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoRead", "TodoWrite"];
  if (readOnlyTools.includes(toolName)) {
    return true;
  }

  // Auto-allow safe bash commands
  if (toolName === "Bash") {
    const command = toolInput.command || "";
    const safeCommands = [
      /^ls\b/,
      /^cat\b/,
      /^head\b/,
      /^tail\b/,
      /^pwd$/,
      /^git status/,
      /^git log/,
      /^git diff/,
      /^bun run (lint|typecheck|test)/,
    ];
    return safeCommands.some((pattern) => pattern.test(command));
  }

  return false;
};
```

## Session Management

### Session Persistence

Sessions are persisted in the Operator DO for resume capability:

```typescript
// In Operator DO
class OperatorDO {
  async saveSession(taskId: string, sessionId: string) {
    await this.sql.exec(
      `UPDATE sessions SET claude_session_id = ? WHERE task_id = ?`,
      sessionId,
      taskId
    );
  }

  async resumeSession(taskId: string): Promise<string | null> {
    const row = await this.sql.exec(
      `SELECT claude_session_id FROM sessions WHERE task_id = ?`,
      taskId
    );
    return row[0]?.claude_session_id || null;
  }
}
```

### Resume Flow

```
1. User sends message to existing task topic
2. Operator DO looks up session ID
3. New Container spawned with sessionId in config
4. Agent SDK resumes with full context
5. Conversation continues seamlessly
```

## Subagents

Define specialized agents for common tasks:

```typescript
const agentDefinitions = {
  "code-reviewer": {
    description: "Expert code reviewer for quality and security reviews",
    prompt: "Analyze code quality, security, and suggest improvements.",
    tools: ["Read", "Glob", "Grep"],
  },
  "test-writer": {
    description: "Writes comprehensive tests for code",
    prompt: "Write tests for the specified code with good coverage.",
    tools: ["Read", "Write", "Glob", "Grep", "Bash"],
  },
  "doc-writer": {
    description: "Writes documentation and comments",
    prompt: "Write clear documentation for the specified code.",
    tools: ["Read", "Write", "Glob"],
  },
};

// Usage in query options
const options = {
  allowedTools: ["Read", "Glob", "Grep", "Task"],
  agents: agentDefinitions,
};
```

## MCP Integration

Connect external tools via MCP:

```typescript
const options = {
  mcpServers: {
    // GitHub integration
    github: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_TOKEN: process.env.GITHUB_PAT,
      },
    },
    // Database access
    postgres: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: {
        DATABASE_URL: process.env.DATABASE_URL,
      },
    },
  },
};
```

## Streaming to Telegram

Stream agent output back to Telegram in real-time:

```typescript
const streamToOperator = (operatorUrl: string, taskId: string, message: any) =>
  Effect.tryPromise(async () => {
    // Format message for Telegram
    let text = "";

    if (message.type === "assistant" && message.message) {
      // Text output from Claude
      text = message.message.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");
    } else if (message.type === "tool_use") {
      // Tool invocation
      text = `🔧 Using ${message.name}...`;
    } else if (message.type === "tool_result") {
      // Tool result (truncated)
      const result = message.content?.substring(0, 500) || "";
      text = `✅ ${result}${result.length >= 500 ? "..." : ""}`;
    }

    if (text) {
      await fetch(`${operatorUrl}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, text }),
      });
    }
  });
```

## Environment Variables

Required in Container:

| Variable | Description | Source |
|----------|-------------|--------|
| `ANTHROPIC_API_KEY` | Claude API key | Secrets Store |
| `AGENT_CONFIG` | JSON config blob | Container spawn |
| `GITHUB_PAT` | GitHub access token | Secrets Store |

## Error Handling

```typescript
const runAgentWithRecovery = (config: AgentConfig) =>
  pipe(
    runAgent(config),
    Effect.catchTag("PermissionDeniedError", (e) =>
      Effect.gen(function* () {
        yield* reportError(config.operatorUrl, config.taskId, `Permission denied: ${e.tool}`);
        return "aborted";
      })
    ),
    Effect.catchTag("SessionExpiredError", (e) =>
      Effect.gen(function* () {
        // Clear session and retry
        yield* clearSession(config.operatorUrl, config.taskId);
        return yield* runAgent({ ...config, sessionId: undefined });
      })
    ),
    Effect.catchAll((e) =>
      Effect.gen(function* () {
        yield* reportError(config.operatorUrl, config.taskId, `Agent error: ${e}`);
        return "failed";
      })
    )
  );
```

## Comparison with claude-army

| Aspect | claude-army | clawdbox |
|--------|-------------|----------|
| Agent execution | Claude CLI subprocess | Agent SDK in Container |
| Permission hook | HTTP to localhost:9000 | HTTP to Operator DO |
| Session storage | File-based session ID | DO SQLite + SDK resume |
| Streaming | Subprocess stdout | HTTP streaming to DO |
| Recovery | Process restart | Container respawn + resume |
