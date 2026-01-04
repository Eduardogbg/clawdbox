# Clawdbox TODO

## Current Session: 004 Agent Container (Takopi)

### In Progress
- [x] Converted `forks/takopi` to a git submodule
- [x] Drafted takopi + Cloudflare Containers design spec
- [x] Add takopi container image + entrypoint (new package)
- [x] Add takopi worker + container DO for start/stop/status
- [x] Extend IaC stack to deploy takopi worker + container binding (container config still wrangler-only)
- [x] Add takopi E2E (deploy, start, stop via wrangler)
- [x] Add dev environment deploy script for takopi (IaC + wrangler)
- [x] Add crane-based container push + registry credential flow for takopi dev deploy
- [x] Allow takopi E2E to use prebuilt registry image (skip Docker when provided)
- [x] Auto-start takopi container after dev deploy (waits for worker health)
- [x] Fix takopi container sleepAfter format, add container-running check, and make dev start idempotent
- [x] Redact takopi secrets from /status (sanitize stored config)
- [x] Allow takopi to accept group chat IDs when configured (TAKOPI_ALLOW_GROUP)
- [x] Auto-delete Telegram webhook on takopi start (TAKOPI_DELETE_WEBHOOK) to allow polling
- [x] Strip command/mention prefixes from takopi updates for privacy-friendly group prompts
- [x] Allow reply fallbacks when Telegram rejects reply_to (allow_sending_without_reply)
- [x] Fix takopi entrypoint patching (newline matching + truthy env flags)
- [x] Pin takopi ref to 8eda3f5 to avoid Python >=3.14 break on master
- [x] Add CODEX_API_KEY alias, TAKOPI_CODEX_ARGS default, and fix _send_or_edit_markdown allow_sending_without_reply patch
- [x] Add takopi log server endpoint for Cloudflare container diagnostics
- [x] Strip wrapping quotes from TAKOPI_CODEX_ARGS (fix codex arg parsing) and refresh dev env
- [x] Normalize TAKOPI_CODEX_ARGS parsing (trim/strip quotes before shlex split) and redeploy dev container
- [x] Add Telegram debug payload for resolved codex args (TAKOPI_DEBUG/TAKOPI_DEBUG_ARGS)
- [x] Include argv in codex failure errors to debug combined-arg issue
- [x] Fix entrypoint codex args patch syntax and restore quoted .env value
- [x] Use chr() in exec_bridge patch to avoid quote-escaping syntax errors
- [x] Move codex extra_args after exec subcommand so --sandbox applies
- [x] Switch default codex args to --dangerously-bypass-approvals-and-sandbox (no --ask-for-approval)
- [x] Add Telegram API debug summary on startup (getMe/getWebhookInfo/getUpdates)

## Current Session: 005 TG Webhook Takopi Port

### In Progress
- [x] Confirm Telegram chat interaction on dev webhook (user message → Codex reply)
- [x] Add /debug/container/ping endpoint for live container health checks
- [x] Normalize CODEX_ARGS parsing + move exec args after `codex exec`
- [x] Add container readiness retries to avoid 10.0.0.1:8080 not listening errors
- [x] Add orchestrator run debug state (last event/error/container response)
- [x] Emit container debug events (spawn/prompt/stdout/exit) for stuck runs
- [x] Pass prompt as codex exec argument to avoid stdin hangs in containers
- [x] Add --skip-git-repo-check to CODEX_ARGS to avoid repo trust errors in container
- [x] Initialize a git repo in /workspace/repo when no repo URL is provided
- [x] Emit debug.env to confirm API key presence inside container

### Completed
- [x] Document Cloudflare compute options for Telegram polling + recommendation
- [x] Replace legacy takopi/operator/telegram packages with new agent-worker + agent-container
- [x] Implement Telegram webhook worker + orchestrator DO (Effect-based)
- [x] Implement container runner (codex exec streaming + progress updates)
- [x] Update IaC/dev deploy scripts and tests to target the new worker/container
- [x] Refresh docs/architecture with the webhook refactor decisions
- [x] Fix dev wrangler config to override worker name (avoid container app collisions)
- [x] Adopt existing D1 database in dev env deploys
- [x] Deploy dev env (dev-mjyuxx7u) and set Telegram webhook
- [x] Add debug endpoints for orchestrator/container and stale-run recovery logic
- [x] Add run start/idle/max timeouts + debug abort to avoid stuck processing
- [x] Stream a run-start marker from the container to avoid run-start timeouts
- [x] Bind container HTTP server to 0.0.0.0 to satisfy Cloudflare container proxy
- [x] Add worker/container env debug endpoints and DO env snapshots
- [x] Bridge Bun.env to process.env for Codex API key detection
- [x] Register Telegram bot commands (/new, /help) during dev deploy

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
├── agent-container/        # Codex runner container
└── agent-worker/           # Telegram webhook worker + DOs
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
5. Decide on Bun vs Vitest for IaC tests (Bun works now without alchemy-effect/test)
6. Expand E2E to include agent-worker/container once Docker + R2 are ready

## Environment Variables Required

```bash
CLOUDFLARE_API_TOKEN=xxx      # API token with account permissions
CLOUDFLARE_ACCOUNT_ID=3a16620c57b98731f762586aeed4f25c
TELEGRAM_BOT_TOKEN=xxx        # From @BotFather
TELEGRAM_SECRET_TOKEN=xxx     # Optional webhook secret
OPENAI_API_KEY=xxx            # Codex API key
CODEX_ARGS=xxx                # Optional codex exec args
CONTAINER_REPO_URL=xxx        # Optional repo clone URL
CONTAINER_REPO_BRANCH=main    # Optional repo branch
```
