# Handoff 005

## Status
- Added run timeouts + abort handling to prevent the orchestrator from hanging on “working - 0s”.
- `debug/orchestrator/reset` now also aborts the active run and clears the in-memory `processing` latch.
- Added env wiring for run timeouts in dev + prod IaC.
- Typecheck passes.

## Changes
- `packages/agent-worker/src/orchestrator-do.ts`
  - Added run start/idle/max timeouts and abort handling.
  - Added `AbortController` tracking so debug reset can cancel a hung run.
  - `consumeJsonlStream` now times out on idle or total duration and updates active-run timestamps on any chunk.
- `packages/agent-worker/src/types.ts`
  - New env vars: `RUN_START_TIMEOUT_MS`, `RUN_IDLE_TIMEOUT_MS`, `RUN_MAX_MS`.
- `packages/iac/src/dev-environment.ts`
  - Dev env schema + vars now include the run timeout envs.
- `packages/iac/src/alchemy.run.ts`, `packages/iac/src/deploy.ts`
  - Production vars now include the run timeout envs.
- `TODO.md` updated to reflect the timeout + abort fix.

## Still Broken / Needs Validation
- Telegram still stalls after “working - 0s” on Cloudflare. Logs were not captured (tail sessions ended mid-run and no console logs surfaced).
- The new timeout behavior is untested in Cloudflare until redeploy.

## How To Deploy + Debug
1) Redeploy dev:
   - `cd packages/iac && bun run dev:env`
2) Tail logs:
   - `cd packages/agent-worker && bunx wrangler tail clawdbox-dev-mjyuxx7u-agent-worker --format pretty`
3) Send a Telegram message while tail is running.
4) If it stalls, use debug endpoints:
   - `GET .../debug/orchestrator?chat_id=-5145863103`
   - `POST .../debug/orchestrator/reset?chat_id=-5145863103`
   - `GET .../debug/container?chat_id=-5145863103`
   - `POST .../debug/container/stop?chat_id=-5145863103`

## Suggested Next Steps
- Redeploy dev env, send a Telegram message while tail is open, confirm logs show run start + container response.
- If still stuck, check whether container responds at all; consider adding a debug endpoint to expose container env (CODEX_ARGS) and run status.
- Tune `RUN_*` env values if timeouts are too aggressive.
