# Handoff 007 - Auto-Start Takopi Dev

## What Changed
- `packages/iac/src/dev-environment.ts` now auto-starts the takopi container after deploy:
  - waits for worker health
  - builds a start payload from env (requires `TAKOPI_BOT_TOKEN`, `TAKOPI_CHAT_ID`, `TAKOPI_REPO_URL`, `OPENAI_API_KEY`)
  - calls `/takopi/dev/start`
- Added health-check + start helpers with `effect` retry schedule.

## Notes
- Dev deploy now fails fast if required start env vars are missing.
- Start uses `TAKOPI_BOT_TOKEN` or falls back to `TELEGRAM_BOT_TOKEN`.

## Next Steps
- Run `cd packages/iac && bun run dev:env` and confirm logs include:
  - "Waiting for worker to become healthy..."
  - "Starting takopi container..."
  - "Dev environment ready (container started)"
