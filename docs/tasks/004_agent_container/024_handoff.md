# 004 Agent Container Handoff (024)

## What Changed
- Adjusted takopi exec_bridge patch to place `extra_args` after `exec` so `--sandbox` and other exec-only flags apply.

## Why
- `--sandbox` is only accepted by `codex exec`; passing it before `exec` left Codex in read-only mode and caused the earlier errors.

## Files
- `packages/takopi-container/entrypoint.sh`
- `TODO.md`

## Next Steps
1. Rebuild and rerun the local container; sandbox should now be danger-full-access.
2. Verify Telegram reply includes the command output instead of the sandbox error.
