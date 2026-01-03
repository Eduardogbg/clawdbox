# 005 TG Webhook Takopi Port - Deliberation

## Goals
- Replace Telegram long-polling with webhook-driven flow.
- Preserve takopi UX: live progress edits, final response, resume IDs.
- Make the system Cloudflare-native (request-driven) while still supporting long-running Codex tasks.
- Prepare for a TypeScript + Effect port with DI-friendly layers.

## Current State (Key Facts)
- Takopi (Python) does long-polling via `getUpdates` and runs `codex exec --json`.
- Container DOs on Cloudflare sleep when idle; long-poll loops are deprovisioned.
- Workers/DOs are request-driven; long-lived polling loops are not a fit.
- Codex CLI runs in the container; Workers cannot spawn processes.

## Constraints
- Telegram webhooks are request/response; no background process required.
- Codex execution must happen in a container (not in Workers).
- We need a safe state store for:
  - chat/session mapping
  - in-flight run tracking
  - resume ID mapping
- Avoid container keep-alive hacks; let it spin up on demand.

## Cloudflare Compute Options (Polling Suitability)
- Workers (HTTP): best for webhooks; not for polling loops.
- Cron Triggers + DO: possible short polling with minute granularity; higher latency.
- Durable Objects: good for state + coordination; still request-driven.
- Containers (Container DO): good for running Codex; will sleep without inbound requests.
- Workflows/Queues: good for orchestration, not for executing Codex directly.

## High-Level Architecture Options

### Option A - Worker -> DO -> Container (Recommended)
1) Telegram webhook hits Worker.
2) Worker validates update + forwards payload to a DO (TakopiOrchestrator).
3) DO decides whether to start/route to a Container DO (TakopiExecContainer).
4) Container runs Codex and sends progress + final messages directly to Telegram API.

Pros:
- Matches Cloudflare request-driven model.
- Container runs only when needed; no polling.
- Keeps Codex execution isolated in container.

Cons:
- Telegram API calls inside container; need careful error handling.
- DO must coordinate concurrency, resume, and cancellation logic.

### Option B - Worker -> Queue -> Container
1) Worker enqueues updates.
2) Queue consumer schedules container runs.
3) Container runs Codex and posts to Telegram.

Pros:
- Queue provides buffering and retries.

Cons:
- Queue consumer is still a Worker (cannot run Codex); still needs DO + container.
- More moving parts with minimal benefit for this flow.

### Option C - Fully port takopi to Worker + Webhook
- Workers cannot run Codex CLI; only feasible if Codex API replaces CLI.

Pros:
- Pure Workers stack.

Cons:
- Requires full agent runtime re-implementation; not aligned with current container-based flow.

## Decision
Proceed with Option A: webhook Worker + DO orchestration + container execution.
Telegram API calls stay in the Worker/DO (not the container), and we use a small
per-chat buffer in DO SQLite instead of Cloudflare Queues.

## Low-Level Design Decisions

### 1) Webhook Worker
- Endpoint: `POST /webhook` (or `/` if preferred by deployment).
- Verify Telegram secret token header (optional) + token in env.
- Immediately ACK with 200 to Telegram.
- Forward the update to DO via `fetch` (async; no long block).

### 2) Orchestrator DO (TypeScript + Effect)
Responsibilities:
- Validate update schema.
- Ignore non-message updates.
- Normalize message text (strip mentions/commands like takopi).
- Maintain per-chat session state (no threads for now):
  - last `resume` id
  - concurrency limits
  - in-flight message IDs
- Small buffer in DO SQLite for pending messages.
- Call container DO to execute Codex; stream events, render progress, and call
  Telegram API (send/edit).

Storage schema (D1 in DO sqlite):
- `sessions(chat_id, resume_id, updated_at)`
- `runs(run_id, chat_id, message_id, status, started_at, finished_at, error)`

### 3) Container DO
- Provides `POST /run` to start Codex:
  - Inputs: prompt, resume_id, repo_url, codex_args
- Ensures container is started and runs Codex CLI.
- Streams JSONL events back to Orchestrator DO.
- Avoids direct Telegram API access.

### 4) Telegram UX Port
Preserve these behaviors from takopi:
- Progress message that updates every ~2s.
- Status lines for command execution / tool calls / file changes.
- Final message with resume id.
- `/new` starts a new context; the whole chat maps to one session.

### 5) TypeScript + Effect Port
Suggested modules:
- `telegram-client` layer (Effect service)
- `update-parser` (Schema validation)
- `progress-renderer` (port from `exec_render.py`)
- `codex-runner` (container-side; spawns codex)
- `orchestrator` (DO) + `worker` (webhook)

## Risks / Open Questions
- Container request duration limits: need to confirm Container DO supports long-running execs.
- Telegram edit limits (rate and size); need backoff or coalescing.
- Resume ID storage and race conditions for concurrent messages.
- Mapping chat -> session -> container lifecycle.

## Suggested Next Steps
1) Design DO interfaces (`/run`, `/status`, `/cancel`) and schemas.
2) Port progress renderer to TS (shared between Worker and Container).
3) Implement webhook Worker + Orchestrator DO skeleton (Effect layers).
4) Build container-side runner API (HTTP server + codex exec + telegram sends).
5) Replace long-polling in takopi container with webhook-driven `POST /run`.
