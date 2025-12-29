# Clawdbox Project TODO

## Session 13 Status
- All 156 tests passing (IAC: 40, Telegram: 45, Agent-container: 43, Agent-worker: 28)
- TypeCheck passes for all packages
- Fixed vitest version mismatch (@effect/vitest requires ^3.2.0, not ^4.0.0)
- Docker buildkit still has registry connectivity issues
- No git remote configured

## Completed
- [x] Fix alchemy-effect dependency to use local fork (tgz tarball)
- [x] Build alchemy-effect fork with proper exports
- [x] Run typecheck on packages/iac
- [x] Create integration tests for Cloudflare resources
- [x] Test Secrets Store deployment via IaC (PASSED!)
- [x] Test Worker deployment via IaC (PASSED!)
- [x] Test D1 Database deployment via IaC (PASSED!)
- [x] Test KV Namespace deployment via IaC (PASSED!)
- [x] Create packages/agent-container structure (Dockerfile, entrypoint, permission hooks)
- [x] Create packages/telegram-webhook (Telegram Bot API, handler, wrangler config)
- [x] Set up CI/CD workflows (.github/workflows/ci.yml, deploy.yml, container.yml)
- [x] Create Operator Durable Object with full CRUD for tasks/sessions/permissions
- [x] Add synchronous permission endpoint with long-polling for agent
- [x] Add E2E tests for Operator (23 tests covering sessions, permissions, task lifecycle)
- [x] Add /status command to Telegram webhook
- [x] Add /cancel command to Telegram webhook
- [x] Create architecture documentation (docs/ARCHITECTURE.md)
- [x] Deploy Operator Worker to Cloudflare
- [x] Create Dockerfile.alpine alternative for network issues
- [x] Verify alchemy-effect fork integration
- [x] Add comprehensive unit tests for all packages
- [x] Fix vitest version mismatch for @effect/vitest (Session 13)

## Blocked
- [ ] Test R2 bucket deployment (R2 not enabled in CF dashboard)
- [ ] Test Queue deployment (Requires Workers Paid plan)
- [ ] Container deployment testing (Docker buildkit registry timeout)
- [ ] Telegram Bot integration (bot token not available)
- [ ] Git push (no remote configured)

## In Progress This Session
- [ ] Try Docker build again with different network options
- [ ] Explore Cloudflare Containers beta
- [ ] Review IaC configuration for containers

## Ready for Future Sessions
- [ ] Once Docker registry fixed: build and push agent-container
- [ ] Once R2 enabled: run R2 test
- [ ] Once Telegram token available: configure webhook
- [ ] Create GitHub repository and push code

## Package Structure

```
packages/
├── iac/                    # Infrastructure as Code
│   ├── src/alchemy.run.ts  # Main IaC entrypoint
│   └── test/               # Integration tests (9 files, 40 tests)
│       ├── secrets-store.test.ts (PASS)
│       ├── worker.test.ts (PASS)
│       ├── d1.test.ts (PASS)
│       ├── kv.test.ts (PASS)
│       ├── queue.test.ts (SKIPPED - paid plan)
│       ├── r2-bucket.test.ts (SKIPPED - R2 not enabled)
│       ├── operator.test.ts (PASS)
│       ├── container.test.ts (PASS - local Docker works)
│       └── operator-e2e.test.ts (PASS - 23 tests)
├── operator/               # Operator Durable Object Worker
│   └── src/
│       ├── index.ts        # Worker entry
│       ├── operator-do.ts  # DO with full CRUD + long-polling permissions
│       ├── types.ts        # Task, Session, Permission types
│       └── sql.ts          # SQL queries
├── agent-container/        # Claude Agent SDK Container
│   ├── Dockerfile          # Bun + Node.js + claude-code
│   ├── Dockerfile.alpine   # Alpine alternative
│   └── src/
│       ├── entrypoint.ts   # Main entry point
│       ├── config.ts       # Schema for agent config
│       ├── permission.ts   # Permission hook for operator
│       └── repo.ts         # Repository cloning/pushing
├── agent-worker/           # Agent Container Worker
│   ├── wrangler.toml       # Container config
│   └── src/
│       ├── index.ts        # Worker entry
│       ├── agent-container-do.ts  # Container DO
│       └── types.ts        # Environment bindings
└── telegram-webhook/       # Telegram Bot Worker
    ├── wrangler.toml       # Cloudflare Worker config
    └── src/
        ├── index.ts        # Worker handler
        ├── handler.ts      # Update processing (/start, /status, etc.)
        ├── telegram.ts     # Telegram API client
        ├── operator-client.ts  # Operator API client
        └── types.ts        # Telegram Bot API types
```

## CI/CD Workflows
- `.github/workflows/ci.yml` - TypeCheck + Unit Tests + Integration Tests
- `.github/workflows/deploy.yml` - Deploy Workers to Cloudflare
- `.github/workflows/container.yml` - Build and push Docker container

## Environment Variables Required
- `CLOUDFLARE_API_TOKEN` - API token with account permissions
- `CLOUDFLARE_ACCOUNT_ID` - 3a16620c57b98731f762586aeed4f25c
- `TELEGRAM_BOT_TOKEN` - (not yet available)
- `ANTHROPIC_API_KEY` - (for agent containers)
- `GITHUB_PAT` - (for private repo access)

## Cloudflare Account Status
- Account ID: 3a16620c57b98731f762586aeed4f25c
- R2: NOT ENABLED (needs dashboard activation)
- Secrets Store: ENABLED (test passes)
- Workers: ENABLED (test passes)
- D1: ENABLED (test passes)
- KV: ENABLED (test passes)
- Queues: NOT ENABLED (requires paid plan)
- Containers: Beta feature (needs special configuration)

## Test Results (Session 13)
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

## Alchemy-Effect Fork Details
Location: `forks/alchemy-effect/alchemy-effect/`
Consumed via: `alchemy-effect-0.6.0.tgz` (tarball in lib/)

Exports tested:
- `./cloudflare` - Main cloudflare module
- `Cloudflare.SecretsStore.Store` - Secrets Store resource (PASS)
- `Cloudflare.Worker.serve` - Worker resource (PASS)
- `Cloudflare.D1.Database` - D1 Database resource (PASS)
- `Cloudflare.KV.Namespace` - KV Namespace resource (PASS)
- `Cloudflare.Queue.Queue` - Queue resource (PASS but needs paid plan)
- `Cloudflare.R2.Bucket` - R2 Bucket resource (needs R2 enabled)
- `Cloudflare.Container` - Container resource (needs Docker)

## Deployed Resources
- **Operator Worker**: https://clawdbox-operator.eduardogbg.workers.dev

## API Endpoints (Operator)

### Tasks
- `POST /tasks` - Create task
- `GET /tasks?status=<status>` - List tasks
- `GET /tasks/:id` - Get task
- `PATCH /tasks/:id/status` - Update task status
- `POST /tasks/:id/spawn` - Spawn agent for task
- `GET /tasks/:id/permissions` - Get pending permissions for task

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

## Docker Issues (Session 12-13)
Docker buildkit cannot fetch metadata from docker.io even when:
- Images exist locally (alpine:3.17 available)
- Network ping works to hub.docker.com
- Various flags tried: --pull=false, --no-cache, DOCKER_BUILDKIT=0

Likely requires Docker Desktop restart or network reconfiguration.

## Commits This Session (13)
1. Fix vitest version mismatch for @effect/vitest compatibility
