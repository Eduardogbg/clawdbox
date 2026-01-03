# 005 TG Webhook Takopi Port Handoff (003)

## What I Did
- Removed legacy packages (`operator`, `telegram-webhook`, `takopi-*`) and rewired the repo to a webhook-first TS+Effect implementation.
- Rebuilt `packages/agent-worker` as the Telegram webhook Worker + Orchestrator DO + Container DO.
- Rebuilt `packages/agent-container` as a Codex runner HTTP service + Dockerfile.
- Updated IaC (`packages/iac`) to deploy the new worker/container and dev environment flow.
- Updated `docs/ARCHITECTURE.md` + `TODO.md` for the new architecture.

## New Architecture (TL;DR)
- Telegram webhook -> Agent Worker -> Orchestrator DO
- Orchestrator DO queues messages, runs Codex, edits progress + posts final replies (adds `resume:`).
- Container DO starts the container and proxies `/run`.
- Container runs codex exec and streams JSONL back to the Orchestrator.

## Key Files
- `packages/agent-worker/src/index.ts` (webhook entry)
- `packages/agent-worker/src/orchestrator-do.ts` (queue + progress rendering)
- `packages/agent-worker/src/agent-container-do.ts` (container lifecycle + proxy)
- `packages/agent-worker/src/codex-progress.ts` (takopi-style progress renderer)
- `packages/agent-worker/src/telegram.ts` + `telegram-render.ts`
- `packages/agent-container/src/index.ts` (codex runner service)
- `packages/agent-container/Dockerfile`
- `packages/iac/src/dev-environment.ts`
- `packages/iac/src/alchemy.run.ts`
- `packages/iac/src/deploy.ts`
- `packages/agent-worker/wrangler.toml`
- `docs/ARCHITECTURE.md`

## Dev Deploy (Webhook + Container)
Use the new dev script (builds/pushes image + wrangler deploy + sets webhook):
```
cd packages/iac
bun run dev:env
```

### Required env (.env)
```
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
TELEGRAM_BOT_TOKEN=...
CODEX_API_KEY=...
```

Optional:
```
TELEGRAM_SECRET_TOKEN=...
CODEX_ARGS="--dangerously-bypass-approvals-and-sandbox -c notify=[]"
CONTAINER_REPO_URL=...
CONTAINER_REPO_BRANCH=main
CONTAINER_WORKDIR=/workspace/repo
MAX_QUEUE_SIZE=5
PROGRESS_EDIT_MS=2000
AGENT_IMAGE=registry.cloudflare.com/<acct>/clawdbox-agent:<tag>
```

## Tests
- Typecheck: `bun run typecheck`
- Agent worker unit tests: `cd packages/agent-worker && bun test`

## Open Items / Next Steps
1. Add an e2e test for webhook + container flow (gated env vars).
2. Validate Cloudflare deploy end-to-end (webhook -> codex -> Telegram reply).
3. Decide on queue/DO backpressure strategy once volume grows.
