# Clawdbox Architecture

> A Telegram-controlled agent orchestration system deployed on Cloudflare

## Overview

Clawdbox enables you to control an army of opinionated Claude agents via Telegram. Each agent runs in an isolated Cloudflare Container with full development tooling, orchestrated by Durable Objects, and managed through a familiar chat interface.

```
                                    CLAWDBOX ARCHITECTURE

    +------------------+          +------------------------+
    |     Telegram     |          |      Cloudflare        |
    |   Forum Group    |          |                        |
    | +------+------+  |          |  +------------------+  |
    | |General| Task |  |   HTTP   |  |  Telegram Worker |  |
    | |Topic | Topics|  | -------> |  |   (webhook)      |  |
    | +------+------+  |          |  +--------+---------+  |
    +------------------+          |           |            |
                                  |           v            |
                                  |  +------------------+  |
                                  |  |  Operator DO     |  |
                                  |  |  - Task queue    |  |
                                  |  |  - Agent state   |  |
                                  |  |  - Permissions   |  |
                                  |  +--------+---------+  |
                                  |           |            |
                                  |           v            |
                                  |  +------------------+  |
                                  |  | Agent Containers |  |
                                  |  | +----+ +----+    |  |
                                  |  | |Agt1| |Agt2|    |  |
                                  |  | +----+ +----+    |  |
                                  |  +--------+---------+  |
                                  |           |            |
                                  |     +-----+-----+      |
                                  |     v           v      |
                                  | +------+   +--------+  |
                                  | |  R2  |   | Secrets|  |
                                  | | Repos|   | Store  |  |
                                  | +------+   +--------+  |
                                  +------------------------+
```

## Core Components

### 1. Telegram Worker
Entry point for all Telegram interactions. Handles:
- Webhook registration and message reception
- Routing messages to appropriate Durable Objects
- Sending responses and permission prompts back to Telegram

**Cloudflare Service**: Workers

### 2. Operator Durable Object
The brain of the system. Manages:
- Task creation and assignment
- Agent lifecycle (spawn, monitor, cleanup)
- Permission request queuing and resolution
- Session state persistence

**Cloudflare Service**: Durable Objects (with SQLite)

### 3. Agent Containers
Isolated execution environments running Claude Agent SDK:
- Pre-built Docker image with `claude-code`, `bun`, `git`
- Ephemeral - spun up per task, destroyed after
- Full filesystem access for repo operations
- Streams output back through DO to Telegram

**Cloudflare Service**: Containers

### 4. R2 Storage
Persistent storage layer for:
- Git repository snapshots (tar.gz)
- Build artifacts and logs
- Agent conversation history (backup)

**Cloudflare Service**: R2

### 5. Secrets Store
Secure credential management:
- Infrastructure secrets (Cloudflare API token)
- Service secrets (Telegram bot token, GitHub PAT)
- Customer secrets (Claude API key)

**Cloudflare Service**: Secrets Store

## Data Flow

### Task Execution Flow
```
1. User sends "/spawn fix login bug" in Telegram
2. Telegram Worker receives webhook
3. Worker routes to Operator DO
4. Operator creates task, spawns Agent Container
5. Container clones repo from R2
6. Claude Agent SDK executes task
7. Permission requests routed back through DO -> Telegram
8. User approves/denies via inline keyboard
9. Agent completes, pushes to GitHub
10. Container destroyed, state persisted in DO
```

### Permission Flow
```
1. Agent requests tool use (e.g., Bash command)
2. Agent SDK hook captures request
3. Request sent to Operator DO via HTTP
4. DO queues permission, notifies Telegram
5. User clicks Allow/Deny button
6. Callback routed through Worker -> DO
7. DO resolves pending permission
8. Agent continues or rejects tool call
```

## Key Design Decisions

### Why Workers + Durable Objects (not persistent Container)?
- **Scale to zero**: No cost when idle
- **Built-in state**: DO provides SQLite persistence
- **WebSocket support**: Real-time Telegram updates
- **Global distribution**: Low latency worldwide

### Why Containers (not Sandbox SDK)?
- **Custom tooling**: Pre-baked claude-code CLI, bun, git
- **Full control**: Dockerfile for reproducible environment
- **No startup penalty**: Tools already installed
- **Docker ecosystem**: Leverage existing images

### Why R2 + Ephemeral Clone (not persistent volumes)?
- **Multi-agent safety**: Each agent gets isolated clone
- **Cost effective**: R2 storage is cheap
- **GitHub as source of truth**: Repos sync via push
- **Crash recovery**: Snapshots enable restoration

## Comparison with claude-army

| Aspect | claude-army | clawdbox |
|--------|-------------|----------|
| Runtime | Local Python daemon | Cloudflare edge |
| State | File-based markers | Durable Object SQLite |
| Agents | Claude CLI subprocess | Claude Agent SDK in Container |
| Scaling | Single machine | Global, scales to zero |
| Git | Local worktrees | R2 snapshots + ephemeral clone |
| Secrets | ~/telegram.json | Cloudflare Secrets Store |
| IaC | None | alchemy-effect |

## Technology Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript |
| Runtime | Bun |
| Effect System | Effect |
| IaC | alchemy-effect |
| Agent SDK | @anthropic-ai/claude-agent-sdk |
| Platform | Cloudflare (Workers, DO, Containers, R2) |
| Interface | Telegram Bot API |
