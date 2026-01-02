# 004 Agent Container Handoff (011)

## What Changed
- Added `TAKOPI_STRIP_COMMANDS` to strip Telegram command/mention prefixes in takopi polling.
- Wired `stripCommands` through worker config/start payload and surfaced in `/status`.
- Updated dev env `.env` and deploy logic to enable stripping by default.

## Why
- Telegram privacy mode only delivers messages that mention the bot or start with `/command`.
- Stripping the prefix makes `/ask hello` behave like a normal prompt, allowing interaction without disabling privacy.

## Files
- `packages/takopi-container/entrypoint.sh`
- `packages/takopi-worker/src/config.ts`
- `packages/takopi-worker/src/takopi-container-do.ts`
- `packages/takopi-worker/src/types.ts`
- `packages/iac/src/dev-environment.ts`
- `packages/iac/.env`
- `TODO.md`

## Commands Run
- `cd packages/iac && bun run dev:env`

## Current State
- `/takopi/dev/status` shows `stripCommands: true` and `running`.
- Bot can send to group; webhook cleared.

## Next Steps
1. Tell user to send `/ask hello` or `/ask@clawdboxbot hello` in the group.
2. If they want plain messages without `/`, disable privacy in BotFather.
