# Clawdbox TODO

## Current Session: Ralph Session 003

### Completed This Session
- [x] Verified all IaC integration tests pass (10 pass, 1 skip for R2)
- [x] Fixed agent-container build script (added --target bun)
- [x] Started Docker Desktop
- [x] Created container build/push CI workflow (.github/workflows/container.yml)
- [x] Updated Dockerfile to not require lockfile
- [x] Created agent-worker package with Container DO
- [x] Implemented AgentContainerDO extending @cloudflare/containers
- [x] Created container test script (scripts/test-local.sh)

### In Progress
- [ ] Docker build of agent-container (network slow, image pull taking time)

---

## Phase 1: Foundation - COMPLETED
- [x] Project setup with Bun + dependencies
- [x] alchemy-effect integration (local fork at forks/alchemy-effect)
- [x] SecretsStore resource (with SDK workaround)
- [x] Integration tests for IaC resources (Worker, SecretsStore pass)
- [x] Container resource in alchemy-effect (binding-only, uses DO namespace)

## Phase 2: Core Infrastructure - COMPLETED
- [x] R2 Bucket for repo storage (defined in alchemy.run.ts, needs R2 enabled)
- [x] Durable Object namespace for Operator (defined as binding)
- [x] Operator Durable Object implementation (packages/operator)
  - SQLite-backed task/session/permission management
  - Full REST API for Worker integration
  - Agent reporting endpoints (/session, /complete, /error)
- [x] Telegram Webhook Worker (packages/telegram-webhook)
  - Integrated with Operator via OperatorClient
  - /task, /status, /help commands
  - Permission approval/denial flow

## Phase 3: Telegram Integration - BLOCKED (needs bot token)
- [x] Webhook handler with validation
- [x] Bot commands: /task, /status, /help
- [x] Topic management (forum support)
- [ ] Requires TELEGRAM_BOT_TOKEN (create via @BotFather)
- [ ] Deploy and configure webhook URL

## Phase 4: Agent Runtime - IN PROGRESS
- [x] Dockerfile for agent container
- [x] Agent entrypoint using Claude Agent SDK
- [x] Permission hook for tool use approval
- [x] Container build CI workflow
- [x] Agent Worker with Container DO (packages/agent-worker)
  - AgentContainerDO extends @cloudflare/containers Container
  - HTTP API: /start, /stop, /status, /health
  - Lifecycle callbacks: onStart, onStop, onError
  - SQLite state tracking
- [ ] Build and test Docker image locally
- [ ] Test actual container deployment with Docker

## Phase 5: Full Integration - PENDING
- [ ] Complete permission flow (Telegram -> Operator DO -> Container)
- [ ] R2 repo snapshot/restore
- [ ] GitHub integration
- [ ] Wire Operator to Agent Worker for spawning

## CI/CD
- [x] GitHub Actions CI for typecheck and tests (ci.yml)
- [x] Deployment workflow for Workers (deploy.yml)
- [x] Container build/push workflow (container.yml)
- [ ] Add agent-worker to deployment workflow

## Package Structure
```
packages/
├── iac/                    # Infrastructure as Code
├── operator/               # Operator Worker + Durable Object
├── agent-container/        # Docker container code for Claude agents
├── agent-worker/           # Worker with Container DO (NEW)
│   ├── src/
│   │   ├── index.ts        # Worker entry point
│   │   ├── agent-container-do.ts  # Container DO class
│   │   └── types.ts
│   └── wrangler.toml       # Container configuration
└── telegram-webhook/       # Telegram Bot Worker
```

## Deployed Resources
- [x] Operator Worker: https://clawdbox-operator.eduardogbg.workers.dev

## Known Issues
- Cloudflare SDK bug: SecretsStore.create() sends array but API expects object
  - Workaround: alchemy-effect uses direct fetch()
  - Local fork has fix: forks/cloudflare-typescript
- R2 not enabled on account (error 10042)
- Container testing requires Docker running locally + wrangler for deployment
- Docker network can be slow for image pulls

## Next Steps
1. Enable R2 on Cloudflare dashboard
2. Create Telegram bot via @BotFather
3. Build Docker container locally (when network permits)
4. Deploy agent-worker to Cloudflare
5. Wire Operator to spawn containers via agent-worker
6. Complete end-to-end integration test
