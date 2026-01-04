# Handoff 006

## Status
- Container run now streams a `run.started` JSONL marker immediately, before any Codex work, so Cloudflare DO fetch returns quickly instead of timing out.
- `RUN_START_TIMEOUT_MS` default bumped to 120s (dev `.env` set to 120000).
- Dev environment redeployed (dev-mjyuxx7u) with new container image and worker.
- Typecheck passes.

## Changes
- `packages/agent-container/src/index.ts`
  - Reworked `runCodex` to return a streaming response immediately.
  - Emits `{ "type": "run.started" }` before repo/bootstrap/spawn to force header flush.
  - Codex spawn, prompt write, and stderr handling now happen inside the stream pump.
  - Added readable-stream guard for stdout/stderr.
- `packages/agent-worker/src/orchestrator-do.ts`
  - `DEFAULT_RUN_START_TIMEOUT_MS` set to 120s.
- `packages/iac/.env`
  - Added `RUN_START_TIMEOUT_MS=120000`.
- `TODO.md` updated.

## Deploy Info
- Worker URL: `https://clawdbox-dev-mjyuxx7u-agent-worker.eduardogbg.workers.dev`
- Latest deploy finished at ~01:21 UTC; version id logged as `b62f42b7-566e-403e-9a62-ae7facfa9e27`.

## What To Test
1) Send a Telegram message now and confirm it no longer returns `error: container run start timed out`.
2) Expect at least progress updates or an error from Codex; if it hangs, check `RUN_IDLE_TIMEOUT_MS`/`RUN_MAX_MS`.

## Notes
- The earlier timeout error likely came from the response headers not flushing until the first Codex output. The `run.started` line should force the response to open immediately.
- If stalls persist, next step is to add a container health/ping debug endpoint to verify the container HTTP server responds.
