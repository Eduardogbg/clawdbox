# 004 Agent Container Handoff (019)

## What Changed
- Added Telegram debug payload that reports raw/normalized/split codex args and whether exec_bridge normalization is present.
- Documented `TAKOPI_DEBUG_ARGS` in takopi container README.

## Why
- Still seeing codex parse error; needed a direct signal from the running container about how args are resolved.

## Files
- `packages/takopi-container/entrypoint.sh`
- `packages/takopi-container/README.md`
- `TODO.md`

## Next Steps
1. Redeploy dev env so the container sends the debug payload on startup.
2. Ask user to confirm the debug message content, especially `split` and `exec_bridge_norm`.
