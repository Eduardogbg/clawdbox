# Clawdbox Architecture

Clawdbox is a system for running Claude agents on Cloudflare infrastructure with Telegram as the user interface.

## System Overview

```
┌─────────────────┐       ┌─────────────────────────────────────────────────────────────┐
│    Telegram     │       │                    Cloudflare Edge                          │
│   (User)        │       │                                                             │
│   ╔═════════╗   │       │  ┌──────────────┐      ┌───────────────┐                    │
│   ║ Chat    ║◄──┼───────┼──┤ Telegram     │      │   Operator    │                    │
│   ║ /task   ║   │       │  │  Webhook     ├─────►│ Durable Object│                    │
│   ║ /status ║   │       │  │  Worker      │      │ (SQLite State)│                    │
│   ║ /help   ║   │       │  └──────────────┘      └───────┬───────┘                    │
│   ╚═════════╝   │       │                                │                            │
└─────────────────┘       │                                ▼                            │
                          │                       ┌────────────────┐                    │
                          │                       │  Agent Worker  │                    │
                          │                       │  (Container DO)│                    │
                          │                       └────────┬───────┘                    │
                          │                                │                            │
                          │                                ▼                            │
                          │                    ┌───────────────────┐    ┌─────────────┐ │
                          │                    │  Agent Container  │    │  R2 Bucket  │ │
                          │                    │  (Claude SDK)     │◄───┤  (Repo      │ │
                          │                    │  Docker + Bun     │    │   Storage)  │ │
                          │                    └───────────────────┘    └─────────────┘ │
                          └─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Telegram Webhook Worker (`packages/telegram-webhook`)
- Receives webhook updates from Telegram Bot API
- Parses commands: `/task`, `/status`, `/help`
- Routes requests to Operator Durable Object
- Handles permission approval/denial via inline buttons

### 2. Operator Durable Object (`packages/operator`)
- Central coordinator for agent orchestration
- SQLite-backed state management:
  - **Tasks**: Task definitions, status, prompts
  - **Sessions**: Container sessions, Claude session IDs
  - **Permissions**: Tool use approval requests
- REST API endpoints:
  - `POST /tasks` - Create new task
  - `GET /tasks/:id` - Get task details
  - `PATCH /tasks/:id/status` - Update task status
  - `POST /sessions` - Create session for task
  - `POST /permission` - Synchronous permission request (long-poll)
  - `POST /permissions/:id/resolve` - Resolve permission
  - `POST /tasks/:id/spawn` - Spawn agent container

### 3. Agent Worker (`packages/agent-worker`)
- Hosts Container-enabled Durable Objects
- Routes requests to specific container instances via `/agent/:id/*`
- Container DO lifecycle management (start, stop, status)

### 4. Agent Container (`packages/agent-container`)
- Docker container running Claude Agent SDK
- Uses `@anthropic-ai/claude-agent-sdk` for agent execution
- Permission hook routes tool approvals through Operator
- Repository cloning from GitHub or R2 tarballs
- Streams output and reports completion/errors

### 5. IaC (`packages/iac`)
- Infrastructure as Code using `alchemy-effect`
- Defines Cloudflare resources:
  - Workers
  - Durable Object namespaces
  - R2 Buckets
  - Secrets Store
- Integration tests for resource deployment

## Data Flow

### Task Creation Flow
```
1. User sends /task command in Telegram
2. Telegram Webhook receives update
3. Webhook creates task via Operator POST /tasks
4. Operator stores task in SQLite
5. Operator spawns agent via Agent Worker POST /spawn
6. Agent Worker starts container with configuration
7. Container clones repo and runs Claude SDK
```

### Permission Flow
```
1. Agent attempts dangerous tool (Bash, Write, Edit)
2. Agent container sends POST /permission to Operator
3. Operator creates pending permission in SQLite
4. Operator notifies user via Telegram (inline buttons)
5. User taps Approve/Deny
6. Telegram Webhook resolves permission
7. Operator long-poll returns result to agent
8. Agent proceeds or blocks based on decision
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
- **Agent**: Claude Agent SDK

## Environment Variables

### Operator Worker
- `AGENT_WORKER_URL` - URL of the Agent Worker

### Agent Container
- `ANTHROPIC_API_KEY` - API key for Claude
- `GITHUB_PAT` - Personal access token for private repos
- `AGENT_CONFIG` - JSON configuration (injected by Container DO)

### Telegram Webhook
- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `OPERATOR_URL` - URL of the Operator Worker

## Deployment

### Prerequisites
1. Cloudflare account with Workers and Containers enabled
2. Docker installed locally for container builds
3. Wrangler CLI authenticated

### Deploy Order
1. **Secrets Store** - Create secrets store with API keys
2. **Operator Worker** - Deploy operator first
3. **Agent Worker** - Deploy with Docker image
4. **Telegram Webhook** - Deploy with bot token
5. **Configure Telegram** - Set webhook URL via Bot API

### Commands
```bash
# Deploy Operator
cd packages/operator && npx wrangler deploy

# Deploy Agent Worker (requires Docker)
cd packages/agent-worker && npx wrangler deploy

# Deploy Telegram Webhook
cd packages/telegram-webhook && npx wrangler deploy

# Run IaC tests
cd packages/iac && bun test
```

## Testing

### Unit Tests
- `packages/iac/test/operator.test.ts` - Operator DO unit tests
- `packages/iac/test/container.test.ts` - Container infrastructure tests

### Integration Tests
- `packages/iac/test/secrets-store.test.ts` - Secrets Store deployment
- `packages/iac/test/worker.test.ts` - Worker deployment
- `packages/iac/test/r2-bucket.test.ts` - R2 bucket (requires R2 enabled)

### E2E Tests
- `packages/iac/test/operator-e2e.test.ts` - Full Operator API tests
  - Task CRUD
  - Session management
  - Permission flow
  - Agent reporting

### Running Tests
```bash
# All tests
cd packages/iac && bun test

# Typecheck all packages
bun run typecheck

# Single test file
cd packages/iac && bun test test/operator-e2e.test.ts
```

## Future Improvements

1. **WebSocket Streaming** - Replace polling with real-time updates
2. **R2 Repo Caching** - Snapshot repos in R2 for faster container starts
3. **Multi-Agent** - Support multiple concurrent agents
4. **GitHub Integration** - PR creation, issue tracking
5. **Conversation Memory** - Resume sessions across container restarts
