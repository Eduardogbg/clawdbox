# Clawdbox Project TODO

## Session 8 Status
- All 33 tests passing (5 new E2E tests added)
- TypeCheck passes for all packages
- Docker Hub unreachable (100% packet loss to registry-1.docker.io)
- No git remote configured
- ghcr.io reachable but bun images not available there

## Completed
- [x] Fix alchemy-effect dependency to use local fork (tgz tarball)
- [x] Build alchemy-effect fork with proper exports
- [x] Run typecheck on packages/iac
- [x] Create integration tests for Cloudflare resources
- [x] Test Secrets Store deployment via IaC (PASSED!)
- [x] Test Worker deployment via IaC (PASSED!)
- [x] Create packages/agent-container structure (Dockerfile, entrypoint, permission hooks)
- [x] Create packages/telegram-webhook (Telegram Bot API, handler, wrangler config)
- [x] Set up CI/CD workflows (.github/workflows/ci.yml, deploy.yml, container.yml)
- [x] Create Operator Durable Object with full CRUD for tasks/sessions/permissions
- [x] Add synchronous permission endpoint with long-polling for agent
- [x] Add E2E tests for Operator (18 tests covering sessions, permissions, task lifecycle)
- [x] Add /status command to Telegram webhook
- [x] Create architecture documentation (docs/ARCHITECTURE.md)
- [x] Deploy Operator Worker to Cloudflare

## In Progress
- [ ] Container image build (blocked: Docker Hub unreachable)

## Blocked
- [ ] Test R2 bucket deployment (R2 not enabled in CF dashboard)
- [ ] Container deployment testing (Docker Hub network issue)
- [ ] Telegram Bot integration (bot token not available)
- [ ] Git push (no remote configured)

## Ready for Next Session
- [ ] Once Docker Hub accessible: build and test agent-container
- [ ] Once R2 enabled: run R2 test
- [ ] Once Telegram token available: configure webhook
- [ ] Create GitHub repository and push code

## Package Structure

```
packages/
├── iac/                    # Infrastructure as Code
│   ├── src/alchemy.run.ts  # Main IaC entrypoint
│   └── test/               # Integration tests (6 files, 28 tests)
│       ├── secrets-store.test.ts (PASS)
│       ├── worker.test.ts (PASS)
│       ├── r2-bucket.test.ts (SKIPPED - R2 not enabled)
│       ├── operator.test.ts (PASS)
│       ├── container.test.ts (PASS - local Docker works)
│       └── operator-e2e.test.ts (PASS - 18 tests)
├── operator/               # Operator Durable Object Worker
│   └── src/
│       ├── index.ts        # Worker entry
│       ├── operator-do.ts  # DO with full CRUD + long-polling permissions
│       ├── types.ts        # Task, Session, Permission types
│       └── sql.ts          # SQL queries
├── agent-container/        # Claude Agent SDK Container
│   ├── Dockerfile          # Bun + Node.js + claude-code
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
- Containers: Beta feature (needs special configuration)

## Test Results (Session 8)
```
 ✓ test/operator.test.ts (2 tests)
 ✓ test/r2-bucket.test.ts (2 tests | 1 skipped)
 ✓ test/container.test.ts (3 tests)
 ✓ test/operator-e2e.test.ts (23 tests)  <- 5 new tests added
 ✓ test/worker.test.ts (2 tests)
 ✓ test/secrets-store.test.ts (2 tests)

 Test Files  6 passed (6)
      Tests  33 passed | 1 skipped (34)
```

### New Tests Added This Session
- `Operator Permission Queries > should create task and session for permission query test`
- `Operator Permission Queries > should get empty permissions list for new task`
- `Operator Permission Queries > should include pending permissions in query`
- `Operator Spawn Agent > should fail spawn without AGENT_WORKER_URL configured`
- `Operator Spawn Agent > should fail spawn without repoUrl`

## Alchemy-Effect Fork Details
Location: `forks/alchemy-effect/alchemy-effect/`
Consumed via: `alchemy-effect-0.6.0.tgz` (tarball in lib/)

Exports added:
- `./test` - Test utilities
- `./cloudflare/secrets-store` - Secrets Store resource
- `./cloudflare/container` - Container resource
- CloudflareApi exposed from `./cloudflare`

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
