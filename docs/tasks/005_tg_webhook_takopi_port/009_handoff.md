# Handoff 009

## What I changed
- Added container readiness retries in the container DO to avoid "not listening on 10.0.0.1:8080" failures (`packages/agent-worker/src/agent-container-do.ts`).
  - The DO now waits for `/health` to succeed before proxying `/run`.
  - If health fails, it restarts the container once and marks state error on failure.

## Deploy/test actions
- Ran `cd packages/iac && bun run dev:env` to redeploy the worker.
- Container app unchanged (same image tag `dev-mjyuxx7u-r2`), worker redeployed.
- `bun run typecheck` passed (agent-container, agent-worker, iac).

## Current status
- Dev worker URL: https://clawdbox-dev-mjyuxx7u-agent-worker.eduardogbg.workers.dev
- Webhook already set.
- Waiting for confirmation that Telegram messages now reach the container without 10.0.0.1:8080 errors.

## Next steps
- Send a Telegram message and report if you still get proxy/not-listening errors.
- If errors persist, use:
  - `GET /debug/container/ping?chat_id=<CHAT_ID>`
  - `GET /debug/orchestrator?chat_id=<CHAT_ID>`
  and share outputs so we can inspect container state and active-run flags.
