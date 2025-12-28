# Cloudflare Services

> Detailed breakdown of Cloudflare services used in clawdbox

## Services Overview

```
+------------------------------------------------------------------+
|                    CLOUDFLARE PLATFORM                           |
|                                                                  |
|  +------------+     +-------------------+     +---------------+  |
|  |  Workers   |     | Durable Objects   |     |  Containers   |  |
|  | - Webhook  |     | - Operator        |     | - Agent env   |  |
|  | - API      |     | - Agent sessions  |     | - claude-code |  |
|  +------------+     +-------------------+     +---------------+  |
|                                                                  |
|  +------------+     +-------------------+     +---------------+  |
|  |     R2     |     |  Secrets Store    |     |      KV       |  |
|  | - Repos    |     | - API keys        |     | - Rate limit  |  |
|  | - Artifacts|     | - Tokens          |     | - Cache       |  |
|  +------------+     +-------------------+     +---------------+  |
|                                                                  |
+------------------------------------------------------------------+
```

## Workers

### Purpose
Stateless HTTP handlers at the edge. Handle incoming requests and route to appropriate services.

### Use Cases in Clawdbox

**Telegram Webhook Handler**
```typescript
// Receives all Telegram updates
export default {
  async fetch(request: Request, env: Env) {
    const update = await request.json();

    // Route to Operator DO
    const operatorId = env.OPERATOR.idFromName("main");
    const operator = env.OPERATOR.get(operatorId);

    return operator.fetch(request);
  }
}
```

**API Endpoints**
- `POST /webhook` - Telegram webhook
- `GET /health` - Health check
- `POST /api/tasks` - Create task (internal)

### Configuration
- **Compatibility date**: Latest stable
- **Node.js compatibility**: Enabled (for claude-code)
- **Bindings**: Durable Objects, R2, Secrets Store

## Durable Objects

### Purpose
Stateful, single-threaded actors with built-in SQLite storage. Perfect for managing agent state and coordination.

### Operator Durable Object

The central coordinator. One instance manages all agents.

**State Schema (SQLite)**
```sql
-- Tasks
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  telegram_topic_id INTEGER,
  status TEXT CHECK(status IN ('pending', 'active', 'completed', 'failed')),
  prompt TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

-- Agent sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  container_id TEXT,
  claude_session_id TEXT,
  status TEXT,
  created_at INTEGER
);

-- Pending permissions
CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  tool_name TEXT,
  tool_input TEXT,
  status TEXT CHECK(status IN ('pending', 'approved', 'denied')),
  created_at INTEGER
);
```

**Key Methods**
```typescript
class OperatorDO implements DurableObject {
  // Task management
  async createTask(prompt: string, topicId: number): Promise<Task>
  async getTask(id: string): Promise<Task | null>
  async updateTaskStatus(id: string, status: TaskStatus): Promise<void>

  // Agent lifecycle
  async spawnAgent(taskId: string): Promise<Session>
  async terminateAgent(sessionId: string): Promise<void>

  // Permissions
  async requestPermission(sessionId: string, tool: ToolUse): Promise<string>
  async resolvePermission(permissionId: string, approved: boolean): Promise<void>

  // WebSocket for real-time updates
  async webSocketMessage(ws: WebSocket, message: string): Promise<void>
}
```

### Agent Session DO (Optional)

If more isolation is needed, each agent can have its own DO:

```typescript
class AgentSessionDO implements DurableObject {
  // Per-agent state
  conversationHistory: Message[]
  currentToolUse: ToolUse | null

  async processMessage(message: string): Promise<void>
  async handleToolResult(result: ToolResult): Promise<void>
}
```

### Why Durable Objects?

| Feature | Benefit |
|---------|---------|
| Single-threaded | No race conditions in permission handling |
| SQLite storage | Structured state, queryable |
| WebSocket support | Real-time streaming to Telegram |
| Auto-hibernation | Cost-effective when idle |
| Global routing | Consistent state access worldwide |

## Containers

### Purpose
Full Linux containers for running the Claude Agent SDK with all development tooling.

### Agent Container Specification

**Base Image**: Custom Dockerfile
```dockerfile
FROM oven/bun:latest

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install claude-code CLI globally
RUN curl -fsSL https://claude.ai/install.sh | bash

# Set up working directory
WORKDIR /workspace

# Entry point script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

**Instance Types**

| Type | vCPU | Memory | Use Case |
|------|------|--------|----------|
| lite | 1/16 | 256MB-2GB | Quick tasks |
| basic | 1/4 | 1GB-4GB | Standard tasks |
| standard-1 | 1/2 | 4GB-8GB | Large repos |

### Container Lifecycle

```
1. Task created -> Container spawned
2. Container boots (~5s with pre-pulled image)
3. Entrypoint clones repo from R2
4. Claude Agent SDK starts
5. Work proceeds with permission callbacks
6. On completion -> push to GitHub
7. Container terminated
8. State persisted in DO
```

### Communication Pattern

```
Container <--HTTP--> Operator DO <--HTTP--> Telegram Worker
    |                    |
    v                    v
Claude Agent SDK    SQLite State
```

## R2 Storage

### Purpose
Object storage for git repositories and artifacts.

### Bucket Structure

```
clawdbox-storage/
├── repos/
│   ├── {owner}/{repo}/
│   │   ├── main.tar.gz          # Main branch snapshot
│   │   ├── feature-xyz.tar.gz   # Feature branch snapshot
│   │   └── metadata.json        # Repo metadata
├── artifacts/
│   ├── {task-id}/
│   │   ├── logs.txt
│   │   └── output/
└── sessions/
    └── {session-id}/
        └── history.json         # Conversation backup
```

### Operations

**Snapshot Repository**
```typescript
async function snapshotRepo(owner: string, repo: string, branch: string) {
  // Clone from GitHub
  await $`git clone --depth 1 -b ${branch} https://github.com/${owner}/${repo}.git`;

  // Create tarball
  await $`tar -czf repo.tar.gz ${repo}`;

  // Upload to R2
  await env.STORAGE.put(`repos/${owner}/${repo}/${branch}.tar.gz`, tarball);
}
```

**Restore to Container**
```typescript
async function restoreRepo(owner: string, repo: string, branch: string) {
  // Download from R2
  const tarball = await env.STORAGE.get(`repos/${owner}/${repo}/${branch}.tar.gz`);

  // Extract
  await $`tar -xzf repo.tar.gz -C /workspace`;
}
```

## Secrets Store

### Purpose
Centralized, encrypted secret management accessible from Workers and Containers.

### Secret Categories

```
clawdbox-secrets/
├── CLOUDFLARE_API_TOKEN     # Infrastructure
├── TELEGRAM_BOT_TOKEN       # Service
├── GITHUB_PAT               # Service
└── ANTHROPIC_API_KEY        # Customer (per-user in future)
```

### Access Pattern

**From Worker**
```typescript
// Secrets Store binding
const apiKey = await env.SECRETS.get("ANTHROPIC_API_KEY");
```

**From Container**
```typescript
// Injected as environment variable during container creation
const config = {
  secrets: [
    { name: "ANTHROPIC_API_KEY", type: "env", secret: "ANTHROPIC_API_KEY" }
  ]
};
```

## KV Namespace (Optional)

### Purpose
Fast key-value storage for caching and rate limiting.

### Use Cases

**Rate Limiting**
```typescript
const key = `rate:${userId}:${Date.now() / 60000}`;
const count = await env.KV.get(key) || 0;
if (count > 10) throw new Error("Rate limited");
await env.KV.put(key, count + 1, { expirationTtl: 60 });
```

**Session Cache**
```typescript
// Cache hot session data
await env.KV.put(`session:${id}`, JSON.stringify(session), {
  expirationTtl: 3600
});
```

## Resource Naming Convention

All Cloudflare resources follow this pattern:
```
{app}-{stage}-{resource}

Examples:
- clawdbox-prod-operator      (Durable Object)
- clawdbox-prod-storage       (R2 Bucket)
- clawdbox-prod-secrets       (Secrets Store)
- clawdbox-dev-worker         (Worker)
```

## Cost Considerations

| Service | Pricing Model | Optimization |
|---------|---------------|--------------|
| Workers | Requests + CPU time | Keep handlers thin |
| Durable Objects | Requests + storage + compute | Use hibernation |
| Containers | Active time + storage | Terminate promptly |
| R2 | Storage + operations | Compress snapshots |
| Secrets Store | Per secret | Consolidate where possible |
| KV | Reads + writes + storage | TTL aggressively |
