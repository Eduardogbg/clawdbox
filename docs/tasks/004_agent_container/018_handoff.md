# 004 Agent Container Handoff (018)

## What Changed
- Normalized `TAKOPI_CODEX_ARGS` parsing to trim whitespace and strip surrounding quotes before `shlex.split`.
- Updated takopi exec_bridge patch to normalize quoted env values even if already patched.
- Rebuilt/pushed image and redeployed dev container.

## Why
- Cloudflare env values may arrive with surrounding quotes, causing Codex to see one combined arg string.

## Files
- `packages/takopi-container/entrypoint.sh`
- `TODO.md`

## Commands Run
- `docker build --platform linux/amd64 --build-arg TAKOPI_REF=... -t clawdbox-takopi:dev-takopi -f packages/takopi-container/Dockerfile packages/takopi-container`
- `docker run --rm --entrypoint python -v /tmp/test_takopi_args.py:/test_takopi_args.py clawdbox-takopi:dev-takopi /test_takopi_args.py`
- `docker run --rm --entrypoint bash clawdbox-takopi:dev-takopi -lc 'codex --sandbox danger-full-access --ask-for-approval never --help >/dev/null'`
- `cd packages/iac && bun run dev:env`
- `curl -s https://clawdbox-dev-takopi-takopi-worker.eduardogbg.workers.dev/takopi/dev/status`
- `curl -s -m 5 https://clawdbox-dev-takopi-takopi-worker.eduardogbg.workers.dev/takopi/dev/logs`

## Current State
- Dev container redeployed and running. Status shows codexArgs as expected.
- `/takopi/dev/logs` still times out (container not listening on port 8080).

## Next Steps
1. Ask user to test the bot now; if still failing, add a different diagnostics path (e.g., Telegram debug message with args or Cloudflare logs).
