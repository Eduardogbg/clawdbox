# Clawdbox TODO

## Current Session: Ralph Session 002

### Completed This Session
- [x] Verified alchemy-effect fork integration
- [x] All typechecks pass (iac, operator, agent-container, telegram-webhook)
- [x] IaC integration tests pass (Worker, SecretsStore - 7 pass, 1 skip for R2)
- [x] Container resource already exists in alchemy-effect fork (binding-only)
- [x] Container binding provider integrated into live.ts
- [x] Created container test fixtures (Dockerfile, worker)

### In Progress
- [ ] Add deployment workflow for Workers
- [ ] Create container integration test (requires Docker + wrangler)

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

## Phase 4: Agent Runtime - READY FOR TESTING
- [x] Dockerfile for agent container
- [x] Agent entrypoint using Claude Agent SDK (stub)
- [x] Permission hook for tool use approval
- [x] Cloudflare Containers now in public beta (June 2025)
- [ ] Wire up container spawning from Operator
- [ ] Test actual container deployment with Docker

## Phase 5: Full Integration - PENDING
- [ ] Complete permission flow (Telegram -> Operator DO -> Container)
- [ ] R2 repo snapshot/restore
- [ ] GitHub integration

## DevOps
- [x] GitHub Actions CI/CD for typecheck and tests
- [ ] Add deployment workflow for Workers
- [ ] Add container build/push workflow

## Next Steps
1. Add GitHub Actions deployment workflow
2. Enable R2 on Cloudflare dashboard
3. Create Telegram bot via @BotFather
4. Deploy Operator Worker to Cloudflare
5. Deploy Telegram Webhook Worker
6. Test container deployment with Docker locally

## Known Issues
- Cloudflare SDK bug: SecretsStore.create() sends array but API expects object
  - Workaround: alchemy-effect uses direct fetch()
  - Local fork has fix: forks/cloudflare-typescript
- R2 not enabled on account (error 10042)
- Container testing requires Docker running locally + wrangler for deployment
