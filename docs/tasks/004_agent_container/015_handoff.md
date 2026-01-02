# 004 Agent Container Handoff (015)

## What Changed
- Defaulted takopi to run codex with full permissions via `TAKOPI_CODEX_ARGS` (`--sandbox danger-full-access --ask-for-approval never`).
- Added runtime patch to inject `TAKOPI_CODEX_ARGS` into takopi's `extra_args` and import `shlex`.
- Fixed `_send_or_edit_markdown` signature patch and ensured `allow_sending_without_reply` flows end-to-end.
- Added CODEX_API_KEY aliasing in the entrypoint and propagate it through takopi worker + IaC.
- Added `TAKOPI_CODEX_ARGS` to dev env config and `.env`.

## Why
- Codex was failing with `401 Unauthorized` and takopi crashed when sending errors, leaving messages stuck on `working`.
- Sandbox errors needed explicit codex flags to allow all permissions.

## Files
- `packages/takopi-container/entrypoint.sh`
- `packages/takopi-container/README.md`
- `packages/takopi-worker/src/config.ts`
- `packages/takopi-worker/src/types.ts`
- `packages/takopi-worker/src/takopi-container-do.ts`
- `packages/iac/src/dev-environment.ts`
- `packages/iac/src/deploy.ts`
- `packages/iac/src/alchemy.run.ts`
- `packages/iac/.env`
- `TODO.md`

## Commands Run
- `docker stop takopi-local`
- `cd packages/iac && bun run dev:env`
- `curl https://clawdbox-dev-takopi-takopi-worker.eduardogbg.workers.dev/takopi/dev/status`
- `./node_modules/.bin/tsc --noEmit`

## Current State
- Cloudflare dev takopi container is running and configured with `codexArgs` full permissions.
- Local container stopped to avoid polling conflicts.

## Next Steps
1. Ask user to test from Telegram and confirm responses now complete.
2. If responses still hang, tail logs from the worker and/or stop container to inspect `getUpdates`.
