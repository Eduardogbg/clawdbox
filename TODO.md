# Clawdbox TODO

## Phase 1: Foundation - COMPLETED
- [x] Project setup with Bun + dependencies
- [x] alchemy-effect integration (local fork)
- [x] SecretsStore resource (with SDK workaround)
- [x] Integration tests for IaC resources (Worker, SecretsStore pass; R2 needs account setup)
- [ ] Container resource in alchemy-effect (beta, deferred)

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

## Phase 3: Telegram Integration - IN PROGRESS
- [x] Webhook handler with validation
- [x] Bot commands: /task, /status, /help
- [x] Topic management (forum support)
- [ ] Requires TELEGRAM_BOT_TOKEN (create via @BotFather)
- [ ] Deploy and configure webhook URL

## Phase 4: Agent Runtime - READY FOR INTEGRATION
- [x] Dockerfile for agent container
- [x] Agent entrypoint using Claude Agent SDK (stub)
- [x] Permission hook for tool use approval
- [ ] Cloudflare Containers beta access needed
- [ ] Wire up container spawning from Operator

## Phase 5: Full Integration - PENDING
- [ ] Complete permission flow (Telegram -> Operator DO -> Container)
- [ ] R2 repo snapshot/restore
- [ ] GitHub integration

## DevOps
- [x] GitHub Actions CI/CD for typecheck and tests
- [ ] Add deployment workflow for Workers

## Next Steps
1. Enable R2 on Cloudflare dashboard
2. Create Telegram bot via @BotFather
3. Deploy Operator Worker to Cloudflare
4. Deploy Telegram Webhook Worker
5. Configure webhook URL with Telegram

## Known Issues
- Cloudflare SDK bug: SecretsStore.create() sends array but API expects object
  - Workaround: alchemy-effect uses direct fetch()
  - Local fork has fix: forks/cloudflare-typescript
- R2 not enabled on account (error 10042)
- Cloudflare Containers in beta (public beta June 2025)
