# Clawdbox TODO

## Current Session: Ralph Session 009

### Completed This Session
- [x] Verified all 33 tests passing
- [x] Verified all typechecks pass
- [x] Verified alchemy-effect fork integration is complete
- [x] Created session 009 handoff document

### Blocked/Deferred
- [ ] Docker image build - 100% packet loss to Docker Hub
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
- [ ] Requires TELEGRAM_BOT_TOKEN (create via @BotFather)
- [ ] Deploy and configure webhook URL

## Phase 4: Agent Runtime - MOSTLY COMPLETE
- [x] Dockerfile for agent container (+ Alpine alternative)
- [x] Agent entrypoint using Claude Agent SDK
- [x] Permission hook for tool use approval (uses /permission endpoint)
- [x] Container build CI workflow
- [x] Agent Worker with Container DO (packages/agent-worker)
- [x] Operator integration for spawning containers
- [ ] Build and test Docker image locally (blocked: Docker Hub unreachable)
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
├── agent-container/        # Docker container code for Claude agents
├── agent-worker/           # Worker with Container DO
└── telegram-webhook/       # Telegram Bot Worker
```

## Deployed Resources
- [x] Operator Worker: https://clawdbox-operator.eduardogbg.workers.dev

## Test Results (Session 009)
```
 ✓ test/operator.test.ts (2 tests)
 ✓ test/r2-bucket.test.ts (2 tests | 1 skipped)
 ✓ test/container.test.ts (3 tests)
 ✓ test/operator-e2e.test.ts (23 tests)
 ✓ test/worker.test.ts (2 tests)
 ✓ test/secrets-store.test.ts (2 tests)

 Test Files  6 passed (6)
      Tests  33 passed | 1 skipped (34)
```

## Known Issues
- Cloudflare SDK bug: SecretsStore.create() sends array but API expects object
  - Workaround: alchemy-effect uses direct fetch()
  - Local fork has fix: forks/cloudflare-typescript
- R2 not enabled on account (error 10042)
- Container testing requires Docker running locally + wrangler for deployment
- Docker network can be slow for image pulls (currently 100% packet loss)

## Next Steps
1. Wait for Docker Hub connectivity
2. Enable R2 on Cloudflare dashboard
3. Create Telegram bot via @BotFather
4. Deploy agent-worker to Cloudflare
5. Set AGENT_WORKER_URL in Operator
6. Complete end-to-end integration test
