# Clawdbox TODO

## Current Session: Ralph Session 011

### Completed This Session
- [x] Verified IAC tests still passing (33 tests)
- [x] Verified all typechecks pass across all packages
- [x] Attempted Docker build - blocked by registry connectivity
- [x] Confirmed network ping works but Docker buildkit metadata fetch times out
- [x] Pruned Docker buildx cache (18GB reclaimed)
- [x] Documented blocking issues

### Blocked/Deferred
- [ ] Docker image build - Docker buildkit cannot fetch metadata from docker.io
  - Ping to hub.docker.com works
  - Alpine image exists locally (3451da08fc6e)
  - Buildkit still tries to verify with registry
  - Tried: --pull=false, --no-cache, prune cache, DOCKER_BUILDKIT=0
- [ ] R2 bucket testing - needs R2 enabled on Cloudflare dashboard
- [ ] Telegram integration - needs bot token from @BotFather
- [ ] Git push - no remote configured

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
  - Container spawning endpoint (/tasks/:id/spawn)
  - Container stopped callback (/container-stopped)
  - Synchronous /permission endpoint with long-polling

## Phase 3: Telegram Integration - BLOCKED (needs bot token)
- [x] Webhook handler with validation
- [x] Bot commands: /task, /status, /help, /cancel
- [x] Topic management (forum support)
- [x] Unit tests for handler (10 tests)
- [ ] Requires TELEGRAM_BOT_TOKEN (create via @BotFather)
- [ ] Deploy and configure webhook URL

## Phase 4: Agent Runtime - MOSTLY COMPLETE
- [x] Dockerfile for agent container (+ Alpine alternative)
- [x] Agent entrypoint using Claude Agent SDK
- [x] Permission hook for tool use approval (uses /permission endpoint)
- [x] Container build CI workflow
- [x] Agent Worker with Container DO (packages/agent-worker)
- [x] Operator integration for spawning containers
- [ ] Build and test Docker image locally (blocked: Docker registry)
- [ ] Test actual container deployment with Docker

## Phase 5: Full Integration - PENDING
- [x] Wire Operator to Agent Worker for spawning
- [x] Permission flow (Agent -> Operator DO -> Long-poll -> Resolution)
- [ ] R2 repo snapshot/restore (needs R2 enabled)
- [ ] GitHub integration
- [ ] Deploy agent-worker and test

## CI/CD
- [x] GitHub Actions CI for typecheck and tests (ci.yml)
- [x] Deployment workflow for Workers (deploy.yml)
- [x] Container build/push workflow (container.yml)
- [x] Agent-worker in deployment workflow (optional deploy)

## Package Structure
```
packages/
├── iac/                    # Infrastructure as Code (33 tests)
├── operator/               # Operator Worker + Durable Object
├── agent-container/        # Claude Agent Container (23 tests)
├── agent-worker/           # Worker with Container DO
└── telegram-webhook/       # Telegram Bot Worker (33 tests)
```

## Deployed Resources
- [x] Operator Worker: https://clawdbox-operator.eduardogbg.workers.dev

## Test Results (Session 011)
```
=== IAC Package (33 tests) ===
 ✓ test/operator.test.ts (2 tests)
 ✓ test/r2-bucket.test.ts (2 tests | 1 skipped)
 ✓ test/container.test.ts (3 tests)
 ✓ test/operator-e2e.test.ts (23 tests)
 ✓ test/worker.test.ts (2 tests)
 ✓ test/secrets-store.test.ts (2 tests)

=== Telegram Package (33 tests) ===
 ✓ test/handler.test.ts (10 tests)
 ✓ test/operator-client.test.ts (11 tests)
 ✓ test/telegram.test.ts (12 tests)

=== Agent Container Package (23 tests) ===
 ✓ test/config.test.ts (9 tests)
 ✓ test/permission.test.ts (14 tests)

 Total: 89 tests passed | 1 skipped (90)
```

## Known Issues
- Cloudflare SDK bug: SecretsStore.create() sends array but API expects object
  - Workaround: alchemy-effect uses direct fetch()
  - Local fork has fix: forks/cloudflare-typescript
- R2 not enabled on account (error 10042)
- Container testing requires Docker running locally + wrangler for deployment
- Docker buildkit cannot fetch registry metadata even with local images

## Next Steps
1. Fix Docker registry connectivity (may need Docker Desktop restart/network changes)
2. Enable R2 on Cloudflare dashboard
3. Create GitHub repo and push all code
4. Create Telegram bot via @BotFather
5. Deploy agent-worker to Cloudflare Containers

## Environment Variables Required

```bash
CLOUDFLARE_API_TOKEN=xxx      # API token with account permissions
CLOUDFLARE_ACCOUNT_ID=3a16620c57b98731f762586aeed4f25c
TELEGRAM_BOT_TOKEN=xxx        # From @BotFather (not yet available)
ANTHROPIC_API_KEY=xxx         # For agent containers
GITHUB_PAT=xxx                # For private repo access
```

## API Endpoints (Operator)

### Tasks
- `POST /tasks` - Create task
- `GET /tasks?status=<status>` - List tasks
- `GET /tasks/:id` - Get task
- `PATCH /tasks/:id/status` - Update task status
- `POST /tasks/:id/spawn` - Spawn agent for task
- `GET /tasks/:id/permissions` - Get pending permissions

### Sessions
- `POST /sessions` - Create session
- `GET /sessions/:id` - Get session

### Permissions
- `POST /permissions` - Create permission (async)
- `POST /permission` - Create + wait for resolution (sync, long-polling)
- `GET /permissions/:id` - Get permission
- `POST /permissions/:id/resolve` - Approve/deny permission

### Agent Callbacks
- `POST /session` - Report Claude session ID
- `POST /complete` - Report task completion
- `POST /error` - Report task error
- `POST /stream` - Stream message to operator

### Container
- `POST /container-stopped` - Container stopped callback
