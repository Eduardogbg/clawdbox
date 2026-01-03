# Clawdbox Architecture

Clawdbox runs Codex agents on Cloudflare infrastructure with Telegram as the user interface.

## System Overview

```
┌─────────────────┐       ┌─────────────────────────────────────────────────────────────┐
│    Telegram     │       │                    Cloudflare Edge                          │
│   (User)        │       │                                                             │
│   ╔═════════╗   │       │  ┌──────────────┐      ┌───────────────┐                    │
│   ║ Chat    ║◄──┼───────┼──┤ Agent Worker │      │ Orchestrator  │                    │
│   ║ /new    ║   │       │  │  (Webhook)   ├─────►│ Durable Object│                    │
│   ║ /help   ║   │       │  └──────────────┘      │ (SQLite State)│                    │
│   ╚═════════╝   │       │                                │                            │
└─────────────────┘       │                                ▼                            │
                          │                       ┌────────────────┐                    │
                          │                       │ Agent Container│                    │
                          │                       │   DO (start)   │                    │
                          │                       └────────┬───────┘                    │
                          │                                │                            │
                          │                                ▼                            │
                          │                    ┌───────────────────┐                    │
                          │                    │  Codex Container  │                    │
                          │                    │  Docker + Bun     │                    │
                          │                    └───────────────────┘                    │
                          └─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Agent Worker (`packages/agent-worker`)
- Receives webhook updates from Telegram Bot API
- Parses commands: `/new`, `/help`
- Routes updates to the Orchestrator Durable Object

### 2. Orchestrator Durable Object (`packages/agent-worker`)
- Central coordinator for chat/session state
- SQLite-backed state:
  - **Chat session**: resume ID + epoch
  - **Message queue**: small buffer before running Codex
  - **Active run**: ensures single run per chat
- Streams Codex progress back to Telegram via edits

### 3. Agent Container DO (`packages/agent-worker`)
- Container-enabled Durable Object that ensures container is running
- Forwards `/run` to the container HTTP server
- Tracks container state in SQLite

### 4. Codex Container (`packages/agent-container`)
- Docker container running Codex CLI
- Exposes HTTP `/run` to start codex exec
- Streams JSONL events back to Orchestrator DO
- Optional repo bootstrap from `REPO_URL`

### 5. IaC (`packages/iac`)
- Infrastructure as Code using `alchemy-effect`
- Defines Cloudflare resources:
  - Workers
  - Durable Object namespaces
  - Secrets Store
- Integration tests for resource deployment

## Data Flow

### Message Flow
```
1. User sends message in Telegram
2. Agent Worker receives webhook update
3. Worker forwards update to Orchestrator DO
4. Orchestrator enqueues + starts container run
5. Container runs Codex CLI and streams JSONL
6. Orchestrator edits progress + posts final reply
```

### Session Flow
```
1. First message starts a Codex session (thread id)
2. Orchestrator persists resume id per chat
3. /new clears session and starts a fresh context
```

### Auto-Allowed Tools
The following tools don't require explicit approval:
- Read (file reading)
- Glob (file pattern matching)
- Grep (content search)
- WebSearch, WebFetch (web content)
- TodoRead, TodoWrite (task management)
- LSP (language server operations)

Safe Bash commands (auto-allowed):
- `ls`, `cat`, `head`, `tail`, `pwd`
- `git status`, `git log`, `git diff`, `git branch`
- `bun run lint|typecheck|test|check`

## Technology Stack

- **Runtime**: Cloudflare Workers (V8 isolates)
- **Compute**: Cloudflare Containers (Docker on edge)
- **State**: Durable Objects with SQLite
- **Storage**: R2 Object Storage
- **Secrets**: Cloudflare Secrets Store
- **Languages**: TypeScript, Effect
- **Build**: Bun
- **IaC**: alchemy-effect (local fork)
- **Agent**: Codex CLI

## Environment Variables

### Agent Worker
- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `TELEGRAM_SECRET_TOKEN` - Webhook secret token (optional)
- `CODEX_API_KEY`/`OPENAI_API_KEY` - Codex API key
- `CODEX_ARGS` - Additional codex exec args
- `CONTAINER_REPO_URL` - Repo clone URL (optional)
- `CONTAINER_REPO_BRANCH` - Repo branch (optional)

## Deployment

### Prerequisites
1. Cloudflare account with Workers and Containers enabled
2. Docker installed locally for container builds
3. Wrangler CLI authenticated

### Deploy Order
1. **Secrets Store** - Create secrets store with API keys
2. **Agent Worker** - Deploy with Docker image
3. **Configure Telegram** - Set webhook URL via Bot API

### Commands
```bash
# Deploy Agent Worker (requires Docker)
cd packages/agent-worker && npx wrangler deploy

# Run IaC tests
cd packages/iac && bun test
```

## Testing

### Unit Tests
- `packages/iac/test/container.test.ts` - Container infrastructure tests

### Integration Tests
- `packages/iac/test/secrets-store.test.ts` - Secrets Store deployment
- `packages/iac/test/worker.test.ts` - Worker deployment
- `packages/iac/test/r2-bucket.test.ts` - R2 bucket (requires R2 enabled)

### E2E Tests
- TBD for Telegram webhook + container flow

### Running Tests
```bash
# All tests
cd packages/iac && bun test

# Typecheck all packages
bun run typecheck

# Single test file
cd packages/iac && bun test test/worker.test.ts
```

## Future Improvements

1. **WebSocket Streaming** - Replace polling with real-time updates
2. **R2 Repo Caching** - Snapshot repos in R2 for faster container starts
3. **Multi-Agent** - Support multiple concurrent agents
4. **GitHub Integration** - PR creation, issue tracking
5. **Conversation Memory** - Resume sessions across container restarts
