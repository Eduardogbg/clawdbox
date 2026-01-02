# Handoff 009 - Takopi Group Chat Support

## What Changed
- Added `TAKOPI_ALLOW_GROUP` support to allow group chat IDs:
  - `packages/takopi-worker/src/config.ts` + `types.ts` handle `allowGroup`.
  - `packages/takopi-container/entrypoint.sh` patches takopi’s chat filter at runtime when `TAKOPI_ALLOW_GROUP=true`.
  - `packages/iac/src/dev-environment.ts` sets `allowGroup` automatically when chat_id is negative and restarts the container before starting.

## Verified
- `bun run dev:env` deploys, stops any running container, and starts a fresh one.
- `/takopi/dev/status` shows `allowGroup: true` and `status: running`.

## Next Steps
- Send a message in the Telegram group. Takopi should now accept it and respond.
