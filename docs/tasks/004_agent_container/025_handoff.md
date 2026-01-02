# 004 Agent Container Handoff (025)

## What Changed
- Updated default codex args to `--dangerously-bypass-approvals-and-sandbox` and removed unsupported `--ask-for-approval` flag.
- Updated `.env` and README to reflect the new default.

## Why
- `codex exec` does not accept `--ask-for-approval`; it rejects the flag and exits with rc=2.

## Files
- `packages/takopi-container/entrypoint.sh`
- `packages/iac/.env`
- `packages/takopi-container/README.md`
- `TODO.md`

## Next Steps
1. Rebuild the local image and rerun takopi with `TAKOPI_CODEX_ARGS="--dangerously-bypass-approvals-and-sandbox"`.
2. Verify Telegram replies execute commands without sandbox errors.
