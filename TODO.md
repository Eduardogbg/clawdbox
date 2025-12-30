# Clawdbox TODO

## Current Session: Post-Ralph Cleanup

### Completed (Post-Ralph)
- [x] Removed pnpm workspace/lockfiles; reverted to Bun-only workspace
- [x] Removed npm/pnpm from agent permission allowlist
- [x] Added Telegram + Cloudflare E2E test (deploys workers, sets webhook, sends message)
- [x] Telegram E2E run succeeded (deploy + webhook + message)
- [x] Ran IaC container test with Docker available
- [x] Migrated tests to `bun:test` and removed Vitest configs/deps
- [x] Typed IaC test context to avoid `any`/internal CLI types and keep typecheck clean
- [x] Ensured IaC integration tests always attempt cleanup via `Effect.ensuring(destroy())`
- [x] Updated Telegram E2E to deploy + message + teardown (Cloudflare cleanup)
- [x] Deleted deployed `clawdbox-*` Cloudflare resources
- [x] Added Cloudflare fetch helper in alchemy-effect fork and used it for Secrets Store create
- [x] Ran Telegram+Cloudflare E2E with test-tagged teardown
- [x] Repacked alchemy-effect tarball and reinstalled deps after fetch helper change
- [x] Added safe E2E tag guard and moved Telegram+Cloudflare E2E to IaC tests
- [x] Gated operator e2e tests behind `RUN_OPERATOR_E2E`
- [x] Exported `alchemy-effect/cli/service` and inlined test CLI layer (no ink/vitest)
- [x] Allowed virtual binding sources in alchemy-effect apply/plan (DO namespace)
- [x] Marked `cloudflare:workers` as external for worker bundling
- [x] Ran full IaC suite with Telegram + Cloudflare E2E (deploy + message + teardown)

### Completed Session 014
- [x] Updated @cloudflare/containers to 0.0.31 (breaking API changes)
- [x] Refactored agent-container-do.ts for new Container API
- [x] Added pnpm-workspace.yaml for proper pnpm workspace support
- [x] Added root tsconfig.json with project references
- [x] Updated .gitignore to exclude pnpm-lock.yaml files
- [x] Excluded repro-sdk-bug from pnpm workspace
- [x] Fixed telegram-webhook wrangler.toml configuration
- [x] All 156 tests passing
- [x] All typechecks pass

### Previous Sessions (011-013)
- Added agent-worker unit tests (28 tests)
- Added telegram-webhook worker tests (12 tests)
- Fixed vitest version mismatch for @effect/vitest
- Added comprehensive E2E tests for Operator (23 tests)
- Deployed Operator Worker to Cloudflare
- Created architecture documentation

### Blocked/Deferred
- [ ] Docker image build - Docker buildkit cannot fetch metadata from docker.io
  - Ping to hub.docker.com works
  - Alpine image exists locally (3451da08fc6e)
  - Buildkit still tries to verify with registry
  - Tried: --pull=false, --no-cache, prune cache, DOCKER_BUILDKIT=0
- [ ] R2 bucket testing - needs R2 enabled on Cloudflare dashboard
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

## Phase 3: Telegram Integration - IN PROGRESS
- [x] Webhook handler with validation
- [x] Bot commands: /task, /status, /help, /cancel
- [x] Topic management (forum support)
- [x] Unit tests for handler (10 tests)
- [x] TELEGRAM_BOT_TOKEN available in telegram.json
- [ ] Deploy and configure webhook URL
- [x] E2E deployment + message test added (see packages/iac/test/telegram-e2e.test.ts)

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
├── iac/                    # Infrastructure as Code (40 tests)
├── operator/               # Operator Worker + Durable Object
├── agent-container/        # Claude Agent Container (43 tests)
├── agent-worker/           # Worker with Container DO (28 tests)
└── telegram-webhook/       # Telegram Bot Worker (45 tests)
```

## Deployed Resources
- [ ] Operator Worker currently deployed (last check: no `clawdbox-*` resources found)

## Test Results (Session 014)
```
=== IAC Package (40 tests) ===
 ✓ test/operator.test.ts (2 tests)
 ✓ test/r2-bucket.test.ts (2 tests | 1 skipped)
 ✓ test/container.test.ts (3 tests)
 ✓ test/operator-e2e.test.ts (23 tests)
 ✓ test/worker.test.ts (2 tests)
 ✓ test/secrets-store.test.ts (2 tests)
 ✓ test/d1.test.ts (2 tests)
 ✓ test/kv.test.ts (2 tests)
 ✓ test/queue.test.ts (2 tests | 1 skipped)

=== Telegram Package (45 tests) ===
 ✓ test/handler.test.ts (10 tests)
 ✓ test/operator-client.test.ts (11 tests)
 ✓ test/telegram.test.ts (12 tests)
 ✓ test/worker.test.ts (12 tests)

=== Agent Container Package (43 tests) ===
 ✓ test/config.test.ts (9 tests)
 ✓ test/permission.test.ts (14 tests)
 ✓ test/repo.test.ts (20 tests)

=== Agent Worker Package (28 tests) ===
 ✓ test/agent-container-do.test.ts (18 tests)
 ✓ test/worker.test.ts (10 tests)

 Total: 154 tests passed | 2 skipped (156)
```

## Test Results (Post-Ralph)
```
=== IaC (full run, RUN_TELEGRAM_E2E=1) ===
 ✓ 16 passed | 25 skipped
 ✓ Telegram + Cloudflare E2E (deploy + webhook + message + teardown)
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
4. Deploy agent-worker to Cloudflare Containers

## Environment Variables Required

```bash
CLOUDFLARE_API_TOKEN=xxx      # API token with account permissions
CLOUDFLARE_ACCOUNT_ID=3a16620c57b98731f762586aeed4f25c
TELEGRAM_BOT_TOKEN=xxx        # From @BotFather
TELEGRAM_CHAT_ID=xxx          # From telegram.json (forum/chat ID)
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
