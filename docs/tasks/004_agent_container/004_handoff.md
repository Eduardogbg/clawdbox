# Agent Container (Takopi) Handoff (004)

## Scope
- Added takopi worker/container to IaC stack definitions.
- Added takopi E2E test that deploys via wrangler and starts/stops the container.
- Updated TODO for takopi E2E completion.

## Changes Made
- `packages/iac/src/alchemy.run.ts`: added TakopiContainer binding + TakopiWorker resource.
- `packages/iac/src/deploy.ts`: applies TakopiWorker and logs worker name.
- `packages/iac/test/takopi-e2e.test.ts`: wrangler deploy/start/stop E2E with guards.
- `TODO.md`: marked takopi IaC + E2E tasks done.

## Commands Run
- `bun run typecheck`

## Notes / Follow-ups
- IaC can define the takopi worker resource, but container image build/push still relies on `wrangler deploy` for now.
- E2E requires Docker + `RUN_TAKOPI_E2E=1` + `TAKOPI_BOT_TOKEN`, `TAKOPI_CHAT_ID`, `TAKOPI_REPO_URL`, `OPENAI_API_KEY`.
- E2E only validates deploy/start/stop; it does not send a Telegram user message (bot APIs don’t emit updates for bot-sent messages).
