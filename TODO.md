# Clawdbox TODO

## Phase 1: Foundation (Current)
- [x] Project setup with Bun + dependencies
- [x] alchemy-effect integration
- [x] SecretsStore resource (with SDK workaround)
- [x] Integration tests for IaC resources (infrastructure ready, integration tests skipped by default)
- [ ] Container resource in alchemy-effect (deferred)

## Phase 2: Core Infrastructure
- [x] R2 Bucket for repo storage (defined in alchemy.run.ts)
- [x] Durable Object namespace for Operator (defined as binding)
- [ ] Worker for Telegram webhook (needs implementation)

## Phase 3: Telegram Integration
- [ ] Webhook handler with validation
- [ ] Bot commands: /spawn, /status, /cleanup, /help, /todo
- [ ] Topic management

## Phase 4: Agent Runtime
- [ ] Dockerfile for agent container
- [ ] Agent entrypoint using Claude Agent SDK
- [ ] Permission hook for tool use approval

## Phase 5: Full Integration
- [ ] Complete permission flow
- [ ] R2 repo snapshot/restore
- [ ] GitHub integration

## Known Issues
- Cloudflare SDK bug: SecretsStore.create() sends array but API expects object
  - Workaround: alchemy-effect uses direct fetch()
  - Local fork has fix: forks/cloudflare-typescript
