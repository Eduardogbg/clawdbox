# Post-Ralph Cleanup Handoff

## Scope
- Removed pnpm workspace/lockfiles to revert to Bun-only workspace.
- Added Telegram + Cloudflare E2E test that deploys workers, sets webhook, and sends a message.
- Migrated tests from Vitest to `bun:test`.
- Updated Telegram test typechecking config for Node/Bun types.
- Ran Docker and IaC container checks.

## Changes Made
- Removed `pnpm-workspace.yaml` and all `pnpm-lock.yaml` files.
- Updated `.gitignore` to drop pnpm-lock ignore.
- Updated `packages/agent-container/src/permission.ts` to remove npm/pnpm auto-allow.
- Updated `docs/ARCHITECTURE.md` safe-command list to Bun-only.
- Added `packages/telegram-webhook/test/e2e.test.ts` and worker health wait before setup.
- Added `packages/telegram-webhook/tsconfig.test.json` for optional test typechecking.
- Added `test:e2e` script to `packages/telegram-webhook/package.json`.
- Fixed telegram-webhook test type errors by widening test tsconfig and decoding JSON with schemas.
- Updated all test imports to `bun:test`, removed Vitest config files, and switched package scripts to `bun test`.

## Commands Run
- `docker info`
- `node <<'NODE' ... bun test test/container.test.ts ... NODE` (IaC container test)
- `node <<'NODE' ... bun test test/e2e.test.ts ... NODE` (Telegram E2E)
- `bun run typecheck`
- `bunx tsc -p tsconfig.test.json --noEmit` (packages/telegram-webhook)
- Created a new Cloudflare API token via API for Workers deploy (not saved in repo).

## Test Results
- IaC container test: PASS (Docker available).
- Telegram E2E: PASS (deploy + webhook + message).
- Typecheck: PASS (all packages).
- Telegram test typecheck: PASS.

## Notes / Follow-ups
- E2E test expects:
  - `RUN_TELEGRAM_E2E=1`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN` with Workers permissions **or** `wrangler login`
  - Optional `CLOUDFLARE_WORKERS_SUBDOMAIN` (otherwise parsed from `packages/telegram-webhook/wrangler.toml`)
  - `telegram.json` with `bot_token` + `chat_id`
- Consider revoking the temporary API token if you do not want it to persist.
- Current token in `docs/references/CLOUDFLARE.md` lacks Workers deploy permissions; need a stronger token or login.

## Suggested Next Actions
1. Enable R2 in Cloudflare dashboard and run remaining IaC tests.
