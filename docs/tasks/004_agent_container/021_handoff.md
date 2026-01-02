# 004 Agent Container Handoff (021)

## What Changed
- Added argv details to codex failure errors so the Telegram error message includes the exact args list.
- Redeployed dev environment with the updated image.

## Why
- Still receiving a combined-arg error; need to see actual argv passed to codex in the running container.

## Files
- `packages/takopi-container/entrypoint.sh`
- `TODO.md`

## Local Checks
- `codex --sandbox danger-full-access --ask-for-approval never exec --help` succeeds inside the image.
- Codex failure now prints `args=[...]` in the error message (verified via local script).

## Next Steps
1. Ask user to re-run and paste the error message; it should now include `args=[...]`.
2. If args show a single combined string, focus on env quoting injection.
3. If args are split correctly, the issue is elsewhere (codex parsing/positioning).
