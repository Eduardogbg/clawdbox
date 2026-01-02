# 004 Agent Container Handoff (010)

## What Changed
- Added `TAKOPI_DELETE_WEBHOOK` support so takopi deletes any active Telegram webhook on startup (entrypoint + config + DO status).
- Dev env now passes `deleteWebhook` by default and records it in `/takopi/:id/status`.
- Updated `packages/iac/.env` to include `TAKOPI_DELETE_WEBHOOK=1`.

## Why
- The bot was still configured for webhook mode (`getWebhookInfo` showed an old e2e URL), which prevents `getUpdates` polling from working.

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
- Telegram API: `deleteWebhook`, `getWebhookInfo` (via node script)

## Current State
- Dev worker: `https://clawdbox-dev-takopi-takopi-worker.eduardogbg.workers.dev`
- `/takopi/dev/status` shows `running` and `deleteWebhook: true`.
- Telegram webhook is cleared (`getWebhookInfo.url == ""`).

## Next Steps
1. If the bot still does not respond in the group, disable privacy mode in BotFather or mention the bot with a `/command` (privacy is still enabled: `can_read_all_group_messages=false`).
2. Add a small operator doc note about webhook vs polling if needed.
