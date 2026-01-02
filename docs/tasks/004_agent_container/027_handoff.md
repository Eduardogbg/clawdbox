# 004 Agent Container Handoff (027)

## What Changed
- Added Telegram API debug summary on startup (getMe/getWebhookInfo/getUpdates) when `TAKOPI_DEBUG` or `TAKOPI_DEBUG_TELEGRAM` is enabled.
- Documented `TAKOPI_DEBUG_TELEGRAM` in the takopi container README.

## Why
- Cloudflare logs are unreachable from this environment; need in-band Telegram diagnostics.

## Files
- `packages/takopi-container/entrypoint.sh`
- `packages/takopi-container/README.md`
- `TODO.md`

## Next Steps
1. Rebuild and redeploy takopi container to Cloudflare.
2. Look for a Telegram message starting with `takopi debug telegram:` and share it.
