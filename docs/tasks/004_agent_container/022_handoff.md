# 004 Agent Container Handoff (022)

## What Changed
- Fixed syntax error in the entrypoint exec_bridge patch (quote escaping for single quote in Python string literal).
- Restored `TAKOPI_CODEX_ARGS` quoting in `packages/iac/.env` now that args normalization strips quotes safely.

## Why
- Local container crashed with a Python `SyntaxError` during patching, preventing takopi from starting.
- Shell `source` of `.env` failed without quotes; normalized parsing now handles quotes.

## Files
- `packages/takopi-container/entrypoint.sh`
- `packages/iac/.env`
- `TODO.md`

## Next Steps
1. Rebuild and run the local container; the SyntaxError should be gone.
2. Capture the updated Telegram error with `args=[...]` for codex failures.
