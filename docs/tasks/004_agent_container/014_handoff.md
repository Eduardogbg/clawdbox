# 004 Agent Container Handoff (014)

## What Changed
- Added CODEX_API_KEY/OpenAI API key aliasing in the takopi entrypoint.
- Fixed takopi exec_bridge patching so `_send_or_edit_markdown` accepts `allow_sending_without_reply` (no TypeError).
- Passed CODEX_API_KEY into takopi container env and allowed dev env to use CODEX_API_KEY as a fallback.
- Updated takopi container README with CODEX_API_KEY alias.
- Added CODEX_API_KEY to `packages/iac/.env`.

## Why
- Local logs showed codex failing with `401 Unauthorized: Missing bearer or basic authentication`.
- The allow_sending_without_reply patch was injecting an argument into `_send_or_edit_markdown` without updating its signature, causing a crash.

## Files
- `packages/takopi-container/entrypoint.sh`
- `packages/takopi-container/README.md`
- `packages/takopi-worker/src/config.ts`
- `packages/iac/src/dev-environment.ts`
- `packages/iac/src/alchemy.run.ts`
- `packages/iac/src/deploy.ts`
- `packages/iac/.env`
- `TODO.md`

## Commands Run
- `docker build --progress=plain -t clawdbox-takopi:dev-takopi packages/takopi-container`
- `docker buildx build --platform linux/amd64 --load -t clawdbox-takopi:dev-takopi packages/takopi-container`
- `docker run --rm --name takopi-local --platform linux/amd64 --env-file packages/iac/.env clawdbox-takopi:dev-takopi`
- `docker exec takopi-local env | rg -n "CODEX_API_KEY|OPENAI_API_KEY"`
- `./node_modules/.bin/tsc --noEmit`

## Current State
- Local takopi container is running (polling) and ready to test.
- Cloudflare takopi container is stopped to avoid getUpdates conflicts.

## Next Steps
1. Send a new message in Telegram to confirm codex now authenticates and replies.
2. If replies work locally, rebuild/push and redeploy the Cloudflare dev environment.
