# Implementation Phases

> Step-by-step build plan for clawdbox

## Phase Overview

```
Phase 1: Foundation        Phase 2: Telegram       Phase 3: Agent Runtime    Phase 4: Integration
─────────────────────     ─────────────────────   ─────────────────────     ─────────────────────
• Project setup           • Webhook handler       • Agent Dockerfile        • Permission flow
• alchemy-effect setup    • Bot commands          • Agent entrypoint        • R2 repo management
• Basic Worker + DO       • Topic management      • Claude SDK integration  • Full Operator logic
• Upstream contributions  • Message routing       • Container spawning      • End-to-end flow
```

## Phase 1: Foundation

### 1.1 Project Setup

```bash
# Initialize project
mkdir clawdbox && cd clawdbox
bun init

# Install dependencies
bun add effect @effect/schema
bun add alchemy-effect
bun add @anthropic-ai/claude-agent-sdk

# Dev dependencies
bun add -d typescript @types/bun
```

**Project structure**:
```
clawdbox/
├── package.json
├── tsconfig.json
├── alchemy.run.ts          # IaC entrypoint
├── src/
│   ├── worker/             # Cloudflare Worker code
│   │   ├── index.ts
│   │   └── telegram.ts
│   ├── durable-objects/    # DO implementations
│   │   └── operator.ts
│   ├── agent/              # Agent container code
│   │   ├── entrypoint.ts
│   │   └── hooks/
│   └── lib/                # Shared utilities
├── Dockerfile              # Agent container
├── secretspec.toml
└── docs/                   # Spec documentation
```

### 1.2 alchemy-effect Setup

```typescript
// alchemy.run.ts
import { Effect, pipe } from "effect";
import * as Cloudflare from "alchemy-effect/cloudflare";

// Basic Worker (placeholder)
class TelegramWorker extends Cloudflare.Worker.serve("TelegramWorker", {
  fetch: Effect.fn(function* (request) {
    return new Response("Clawdbox is running!");
  }),
})({
  main: "./src/worker/index.ts",
  bindings: $(),
}) {}

export default TelegramWorker;
```

### 1.3 Upstream Contributions

Fork alchemy-effect and add missing resources:

**Priority order**:
1. `DurableObjectNamespace` - Required for Operator DO
2. `Container` / `ContainerApplication` - Required for agents
3. `SecretsStore` - Required for secrets

**Contribution workflow**:
```bash
# Fork alchemy-effect
git clone https://github.com/YOUR_USER/alchemy-effect
cd alchemy-effect

# Create feature branch
git checkout -b feat/cloudflare-durable-objects

# Implement resource (reference alchemy/alchemy/src/cloudflare/*)
# Add tests
# Submit PR
```

### 1.4 Basic Worker + DO

```typescript
// src/worker/index.ts
import { Effect } from "effect";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/webhook") {
      // Route to Operator DO
      const operatorId = env.OPERATOR.idFromName("main");
      const operator = env.OPERATOR.get(operatorId);
      return operator.fetch(request);
    }

    return new Response("Clawdbox", { status: 200 });
  },
};

// src/durable-objects/operator.ts
import { DurableObject } from "cloudflare:workers";

export class OperatorDO extends DurableObject {
  sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Initialize schema
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        prompt TEXT,
        status TEXT,
        created_at INTEGER
      )
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK");
    }

    return new Response("Operator DO", { status: 200 });
  }
}
```

### Phase 1 Deliverables

- [ ] Project initialized with dependencies
- [ ] Basic alchemy.run.ts deploying empty Worker
- [ ] DurableObjectNamespace resource PR submitted
- [ ] Operator DO with SQLite schema
- [ ] Local dev environment working

---

## Phase 2: Telegram Integration

### 2.1 Webhook Handler

```typescript
// src/worker/telegram.ts
import { Effect } from "effect";
import { TelegramUpdate, handleUpdate } from "../lib/telegram";

export const webhookHandler = (request: Request, env: Env) =>
  Effect.gen(function* () {
    // Validate webhook secret
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Parse update
    const update: TelegramUpdate = yield* Effect.tryPromise(() =>
      request.json()
    );

    // Handle update
    yield* handleUpdate(update, env);

    return new Response("OK");
  });
```

### 2.2 Bot Commands

```typescript
// src/lib/commands.ts
import { Effect } from "effect";

interface CommandContext {
  chatId: number;
  topicId?: number;
  args: string;
  env: Env;
}

const commands: Record<string, (ctx: CommandContext) => Effect.Effect<void>> = {
  spawn: (ctx) =>
    Effect.gen(function* () {
      // Create task
      const taskId = crypto.randomUUID();

      // Create topic
      const topic = yield* createTopic(ctx.chatId, `Task: ${ctx.args.slice(0, 20)}`);

      // Store task
      yield* storeTask(ctx.env, {
        id: taskId,
        prompt: ctx.args,
        topicId: topic.message_thread_id,
        status: "pending",
      });

      // Acknowledge
      yield* sendMessage(ctx.chatId, `🚀 Task created: ${taskId}`);
    }),

  status: (ctx) =>
    Effect.gen(function* () {
      const tasks = yield* getTasks(ctx.env);
      const message = formatTaskList(tasks);
      yield* sendMessage(ctx.chatId, message, { message_thread_id: ctx.topicId });
    }),

  cleanup: (ctx) =>
    Effect.gen(function* () {
      const taskId = ctx.args.trim();
      yield* cleanupTask(ctx.env, taskId);
      yield* sendMessage(ctx.chatId, `🗑️ Cleaned up: ${taskId}`);
    }),

  help: (ctx) =>
    Effect.gen(function* () {
      yield* sendMessage(ctx.chatId, HELP_TEXT, { message_thread_id: ctx.topicId });
    }),
};
```

### 2.3 Topic Management

```typescript
// src/lib/telegram.ts
const TELEGRAM_API = "https://api.telegram.org/bot";

export const createTopic = (chatId: number, name: string) =>
  Effect.tryPromise(async () => {
    const response = await fetch(`${TELEGRAM_API}${BOT_TOKEN}/createForumTopic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        name: name.substring(0, 128),
      }),
    });
    return (await response.json()).result;
  });

export const closeTopic = (chatId: number, topicId: number) =>
  Effect.tryPromise(async () => {
    await fetch(`${TELEGRAM_API}${BOT_TOKEN}/closeForumTopic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_thread_id: topicId,
      }),
    });
  });
```

### 2.4 Message Routing

```typescript
// src/durable-objects/operator.ts
async handleMessage(message: TelegramMessage) {
  const topicId = message.message_thread_id;

  if (!topicId) {
    // General topic - operator chat
    return this.handleOperatorChat(message);
  }

  // Find task for topic
  const task = await this.getTaskByTopic(topicId);
  if (task) {
    // Forward to agent (if running)
    return this.forwardToAgent(task.id, message.text);
  }
}
```

### Phase 2 Deliverables

- [ ] Webhook registered with Telegram
- [ ] /spawn command creates topics
- [ ] /status shows task list
- [ ] /cleanup removes tasks
- [ ] Messages route to correct handler
- [ ] Inline keyboards for future permissions

---

## Phase 3: Agent Runtime

### 3.1 Agent Dockerfile

```dockerfile
# Dockerfile
FROM oven/bun:latest

# System deps
RUN apt-get update && apt-get install -y \
    git curl openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Node.js for claude-code
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Agent code
WORKDIR /agent
COPY package.json bun.lockb ./
RUN bun install
COPY src/ ./src/

WORKDIR /workspace
ENTRYPOINT ["bun", "run", "/agent/src/entrypoint.ts"]
```

### 3.2 Agent Entrypoint

```typescript
// src/agent/entrypoint.ts
import { Effect, pipe } from "effect";
import { query } from "@anthropic-ai/claude-agent-sdk";

const config = JSON.parse(process.env.AGENT_CONFIG!);

const main = pipe(
  Effect.gen(function* () {
    // Setup workspace
    yield* setupWorkspace(config);

    // Run agent loop
    for await (const message of query({
      prompt: config.prompt,
      options: {
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        workingDirectory: "/workspace",
        hooks: {
          PreToolUse: [{ matcher: ".*", hooks: [permissionHook] }],
        },
      },
    })) {
      yield* streamToOperator(config.operatorUrl, config.taskId, message);
    }

    // Complete
    yield* completeTask(config);
  }),
  Effect.catchAll((e) => reportError(config, e))
);

Effect.runPromise(main);
```

### 3.3 Container Spawning

```typescript
// src/durable-objects/operator.ts
async spawnAgent(taskId: string) {
  const task = await this.getTask(taskId);

  // Get container stub
  const containerId = this.env.AGENT_CONTAINER.idFromName(taskId);
  const container = this.env.AGENT_CONTAINER.get(containerId);

  // Configure agent
  const agentConfig = {
    taskId,
    prompt: task.prompt,
    repoUrl: task.repoUrl,
    branch: task.branch || "main",
    operatorUrl: `https://clawdbox.workers.dev/operator/${this.ctx.id}`,
  };

  // Start container with config
  await container.fetch(new Request("http://internal/start", {
    method: "POST",
    body: JSON.stringify(agentConfig),
  }));

  // Update task status
  await this.updateTask(taskId, { status: "active", containerId: containerId.toString() });
}
```

### 3.4 Claude SDK Integration

```typescript
// src/agent/hooks/permission.ts
export const permissionHook = async (input: any, toolUseId: string, context: any) => {
  const config = JSON.parse(process.env.AGENT_CONFIG!);
  const toolName = input.tool_name;
  const toolInput = input.tool_input;

  // Auto-allow safe tools
  if (isAutoAllowed(toolName, toolInput)) {
    return {};
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
  return result.approved ? {} : { decision: "block", reason: "Denied by user" };
};
```

### Phase 3 Deliverables

- [ ] Dockerfile builds successfully
- [ ] Container image pushed to Cloudflare registry
- [ ] Agent can be spawned from Operator
- [ ] Claude SDK runs in container
- [ ] Output streams to Operator
- [ ] Container terminates on completion

---

## Phase 4: Full Integration

### 4.1 Permission Flow

```typescript
// src/durable-objects/operator.ts
async handlePermissionRequest(taskId: string, toolName: string, toolInput: string) {
  const task = await this.getTask(taskId);

  // Store pending permission
  const permissionId = crypto.randomUUID();
  await this.sql.exec(
    `INSERT INTO permissions (id, task_id, tool_name, tool_input, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    permissionId, taskId, toolName, toolInput, Date.now()
  );

  // Send to Telegram
  await sendPermissionRequest(
    this.env.TELEGRAM_CHAT_ID,
    task.topicId,
    permissionId,
    toolName,
    toolInput
  );

  // Wait for resolution (with timeout)
  return this.waitForPermission(permissionId, 300000); // 5 min timeout
}

async resolvePermission(permissionId: string, approved: boolean) {
  await this.sql.exec(
    `UPDATE permissions SET status = ? WHERE id = ?`,
    approved ? "approved" : "denied",
    permissionId
  );

  // Wake up waiting request
  this.permissionResolvers.get(permissionId)?.(approved);
}
```

### 4.2 R2 Repo Management

```typescript
// src/lib/repos.ts
export const syncRepo = (owner: string, repo: string, branch: string) =>
  Effect.gen(function* () {
    // Clone from GitHub
    const tempDir = `/tmp/${crypto.randomUUID()}`;
    yield* Effect.tryPromise(() =>
      $`git clone --depth 1 -b ${branch} https://github.com/${owner}/${repo}.git ${tempDir}`
    );

    // Create tarball
    const tarball = yield* Effect.tryPromise(() =>
      $`tar -czf - -C ${tempDir} .`.arrayBuffer()
    );

    // Upload to R2
    yield* Effect.tryPromise(() =>
      env.REPOS.put(`repos/${owner}/${repo}/latest/${branch}.tar.gz`, tarball)
    );

    // Cleanup
    yield* Effect.tryPromise(() => $`rm -rf ${tempDir}`);
  });

export const restoreRepo = (owner: string, repo: string, branch: string, targetDir: string) =>
  Effect.gen(function* () {
    const tarball = yield* Effect.tryPromise(() =>
      env.REPOS.get(`repos/${owner}/${repo}/latest/${branch}.tar.gz`)
    );

    if (!tarball) {
      yield* Effect.fail(new Error("No snapshot found"));
    }

    yield* Effect.tryPromise(async () => {
      const buffer = await tarball.arrayBuffer();
      await $`tar -xzf - -C ${targetDir}`.stdin(new Uint8Array(buffer));
    });
  });
```

### 4.3 Full Operator Logic

```typescript
// src/durable-objects/operator.ts - complete implementation
export class OperatorDO extends DurableObject {
  // ... previous code ...

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/webhook":
        return this.handleTelegramWebhook(request);

      case "/command":
        return this.handleCommand(request);

      case "/message":
        return this.handleMessage(request);

      case "/permission":
        return this.handlePermissionRequest(request);

      case "/permission/resolve":
        return this.handlePermissionResolve(request);

      case "/stream":
        return this.handleAgentStream(request);

      case "/complete":
        return this.handleTaskComplete(request);

      default:
        return new Response("Not found", { status: 404 });
    }
  }
}
```

### 4.4 End-to-End Flow

```
1. User: /spawn fix login bug
2. Worker receives webhook → routes to Operator DO
3. Operator creates task + Telegram topic
4. Operator syncs repo to R2 (if needed)
5. Operator spawns Container with agent config
6. Container restores repo from R2
7. Agent SDK starts working
8. Agent requests Bash permission
9. Operator sends inline keyboard to Telegram
10. User clicks Allow
11. Operator resolves permission → agent continues
12. Agent completes → pushes branch to GitHub
13. Container terminates
14. Operator updates task status
15. User notified in topic
```

### Phase 4 Deliverables

- [ ] Permission flow works end-to-end
- [ ] R2 repo sync/restore operational
- [ ] Full task lifecycle working
- [ ] Agent output streams to Telegram
- [ ] Error handling and recovery
- [ ] Documentation updated

---

## Testing Strategy

### Unit Tests

```typescript
// tests/operator.test.ts
import { it, expect } from "bun:test";
import * as Effect from "effect/Effect";

it("creates task with topic", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const operator = new OperatorDO(mockCtx, mockEnv);
      const task = yield* operator.createTask("fix bug", 123);

      expect(task.status).toBe("pending");
      expect(task.topicId).toBe(123);
    })
  );
});
```

### Integration Tests

```typescript
// tests/integration/e2e.test.ts
it("completes full task flow", async () => {
  // Simulate /spawn
  const spawnResponse = await worker.fetch("/webhook", {
    method: "POST",
    body: JSON.stringify({
      message: { text: "/spawn fix bug", chat: { id: 123 } },
    }),
  });

  expect(spawnResponse.ok).toBe(true);

  // Wait for agent to complete
  await waitForTaskCompletion(taskId);

  // Verify GitHub branch created
  const branches = await listGitHubBranches(repo);
  expect(branches).toContain(`clawdbox/${taskId}`);
});
```

## Deployment

### Initial Deploy

```bash
# Set environment variables
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export TELEGRAM_BOT_TOKEN=...
export ANTHROPIC_API_KEY=...

# Deploy
bun run alchemy.run.ts --apply
```

### CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run alchemy.run.ts --apply
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```
