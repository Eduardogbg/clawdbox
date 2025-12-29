# Clawdbox TODO

## Phase 1: Foundation
- [x] Project setup with Bun + dependencies
- [x] alchemy-effect integration (local fork)
- [x] SecretsStore resource (with SDK workaround)
- [x] Integration tests for IaC resources (Worker, SecretsStore pass; R2 needs account setup)
- [ ] Container resource in alchemy-effect (beta, deferred)

## Phase 2: Core Infrastructure
- [x] R2 Bucket for repo storage (defined in alchemy.run.ts, needs R2 enabled)
- [x] Durable Object namespace for Operator (defined as binding)
- [x] Operator Durable Object implementation (packages/operator)
  - SQLite-backed task/session/permission management
  - Full REST API for Worker integration
- [ ] Worker for Telegram webhook (stub exists in packages/telegram-webhook)

## Phase 3: Telegram Integration
- [ ] Webhook handler with validation
- [ ] Bot commands: /spawn, /status, /cleanup, /help, /todo
- [ ] Topic management
- [ ] Requires TELEGRAM_BOT_TOKEN (create via @BotFather)

## Phase 4: Agent Runtime
- [ ] Dockerfile for agent container
- [ ] Agent entrypoint using Claude Agent SDK
- [ ] Permission hook for tool use approval
- [ ] Cloudflare Containers beta access needed

## Phase 5: Full Integration
- [ ] Complete permission flow (Telegram -> Operator DO -> Container)
- [ ] R2 repo snapshot/restore
- [ ] GitHub integration

## Current Session Progress
- [x] Verified IaC integration tests pass (Worker, SecretsStore)
- [x] Created packages/operator with full Durable Object implementation
- [x] Added operator test infrastructure
- [ ] GitHub Actions CI/CD for automated tests
- [ ] Deploy Operator to Cloudflare

## Known Issues
- Cloudflare SDK bug: SecretsStore.create() sends array but API expects object
  - Workaround: alchemy-effect uses direct fetch()
  - Local fork has fix: forks/cloudflare-typescript
- R2 not enabled on account (error 10042)
- Cloudflare Containers in beta (public beta June 2025)
