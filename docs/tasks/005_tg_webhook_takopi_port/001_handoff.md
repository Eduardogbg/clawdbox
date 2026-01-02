# 005 TG Webhook Takopi Port Handoff (001)

## What I Did
- Started studying takopi internals (telegram client, exec render, exec bridge loop).
- Drafted deliberation doc covering Cloudflare compute fit, webhook architecture, and TS+Effect port boundaries.
- Updated TODO for the new task.

## Key Notes from Takopi Code
- `exec_bridge.py` handles long-polling (`getUpdates`), dispatches to workers, and runs `codex exec --json`.
- Progress UX is in `exec_render.py` (status lines + edits + resume id).
- Telegram client wraps Bot API calls with error logging.
- Resume IDs are embedded in responses and extracted from messages.

## Decisions (Initial)
- Replace polling with webhook Worker -> Orchestrator DO -> Container DO.
- Keep Codex execution inside container; Workers/DOs stay request-driven.
- Port progress renderer + resume/cancel behavior to TS.
- Use Effect services for Telegram client, update parsing, and orchestration.

## Files
- `docs/tasks/005_tg_webhook_takopi_port/000_deliberation.md`
- `docs/tasks/005_tg_webhook_takopi_port/001_handoff.md`
- `TODO.md`

## Next Steps
1. Define DO APIs (`/run`, `/status`, `/cancel`) + schemas.
2. Port progress renderer to TS and validate formatting against takopi.
3. Implement webhook Worker + Orchestrator DO skeleton in TS/Effect.
4. Decide container runtime (Node/Bun) for Codex runner.
