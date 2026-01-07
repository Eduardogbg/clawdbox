# 006 Management Handoff

## Status
- Manager DO exists inside agent-worker with SQLite tables for settings + credentials.
- `/settings` sets the canonical settings thread (topic-only) and routes settings commands to Manager DO.
- `/auth` now runs an interactive flow in the settings topic (or private chat) to store Cloudflare + Codex keys.
- CLI onboarding helper added (`bun run manager:auth`) to post credentials to `/cli/register`.
- Bot commands include `/settings`, `/auth`, and `/rename` for dev deploys.
- Cloudflare deployer token created (shared out-of-band; not stored in repo).

## Key files
- `packages/agent-worker/src/manager-do.ts`
- `packages/agent-worker/src/index.ts`
- `packages/agent-worker/src/orchestrator-do.ts`
- `packages/iac/src/manager-auth.ts`
- `packages/iac/src/dev-environment.ts`
- `packages/agent-worker/wrangler.toml`
- `packages/iac/src/deploy.ts`
- `packages/iac/src/alchemy.run.ts`

## Open work
- Implement usage/visibility endpoints (sessions/containers) in Manager DO.
- Decide how Manager DO should surface deployments (store + query).
- Determine whether CLI should run `dev:env` after registration or add a `manager:deploy` command.

## Commands
- Typecheck: `bun run typecheck`
- Register credentials:
  - `cd packages/iac`
  - `bun run manager:auth -- --url https://<worker-url>`
  - Requires `MANAGER_CLI_TOKEN` in `.env`.
