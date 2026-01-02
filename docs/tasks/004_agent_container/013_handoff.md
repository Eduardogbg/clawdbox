# 004 Agent Container Handoff (013)

## What Changed
- Fixed takopi entrypoint patching (real newline matches, truthy/falsey env handling).
- Pinned takopi install ref to `8eda3f5e84f960e6961ee1e05ae24a23752e16e7` to avoid upstream Python >=3.14 requirement.
- Updated takopi container README with new env flags and ref default.
- Regenerated dev env `.env` entries from `telegram.json` (bot/chat, TAKOPI_REF, TAKOPI_FINAL_NOTIFY).
- Rebuilt/pushed takopi image and redeployed dev environment.

## Why
- Container startup was failing due to a bad patch script (`\\n` literals + strict boolean checks), so takopi never entered the polling loop.
- New takopi master requires Python >=3.14; pinning keeps builds on Python 3.12.

## Files
- `packages/takopi-container/entrypoint.sh`
- `packages/takopi-container/Dockerfile`
- `packages/takopi-container/README.md`
- `packages/iac/src/dev-environment.ts`
- `packages/iac/.env`
- `TODO.md`

## Commands Run
- `docker build --progress=plain -t clawdbox-takopi:dev-takopi packages/takopi-container`
- `cd packages/iac && bun run dev:env`
- `curl https://clawdbox-dev-takopi-takopi-worker.eduardogbg.workers.dev/takopi/dev/status`

## Current State
- Dev worker deployed and container started (status: running).
- Webhook is cleared; takopi is polling for updates.

## Next Steps
1. Ask user to send a normal message in the group and confirm takopi replies now.
2. If no reply, stop the container and run a manual `getUpdates` check to confirm inbound messages before restarting.
