# Takopi upstream feature delta (v0.1.0-8 -> v0.17.1)

## Scope

- Local submodule pinned at `8eda3f5` (tagged `v0.1.0-8-g8eda3f5`).
- Upstream head at `origin/master` commit `f060d3b` (tagged `v0.17.1`).
- Primary sources: `forks/takopi` changelog and upstream README/changelog.

## Major additions since v0.1.0

### Multi-engine runner system

- Runner protocol introduced (started/action/completed) with normalized event model.
- New runners: Claude Code, Opencode, Pi (all with JSONL streaming + resume).
- Auto-router runner selection with default engine + `/{engine}` overrides.
- Engine registry auto-discovers available backends and populates CLI subcommands.

### Projects and worktrees

- `takopi init <alias>` registers a repo and enables project aliases.
- `@branch` routing to git worktrees (auto-create, resolve, validate roots).
- Context footers (`ctx: project @branch`) for persistent routing.
- Per-project defaults (engine, worktree base) and per-project chat routing.

### Telegram UX and transport changes

- Telegram transport split into transport + presenter architecture.
- Group chat support by relaxing ACL to chat id only.
- Forum topics support with `/topic` and `/ctx` for topic-bound context.
- Thread-aware replies and topic scope handling.
- Inline cancel button + `/cancel` improvements.
- File transfer support (upload/download) + hardened file handling.
- Voice note transcription support + configurable transcription model.
- Chat session mode for auto-resume per chat (`session_mode = "chat"`).
- Optional resume line + message overflow split mode.
- Prompt auto-run from file upload caption (`auto_put_mode = "prompt"`).
- Per-chat/topic default agents (latest master).

### Plugins and public API

- Entry-point plugin system for engines, transports, and commands.
- `takopi plugins` command and public API docs.
- Plugin context expanded (thread id, sender id, raw message references).

### Ops/config/runtime

- Config migrated to pydantic-settings; telegram config moved under `[transports.telegram]`.
- Config hot-reload via watchfiles.
- Lockfile prevents multiple instances racing the same bot token.
- Telegram rate-limit queue with retry-after backoff.
- Structlog-based logging + msgspec schemas for JSONL decoding.
- Skip git repo check for codex runs (now standard).

### Documentation expansion

- Detailed docs: specification, architecture, user guide, runners, plugins, transports.
- Cheat sheets for codex/claude/opencode/pi event streams.

## Notable fixes to track

- Resume handling improvements (optional resume line, prompt upload alignment).
- Windows session path fixes and worktree reuse.
- Hardened file transfer and onboarding error handling.

## Implications for our TypeScript bridge

- Features we have already mirrored: forum topics, thread-aware replies, group chat handling, resume ids, progress streaming, auto-cancel, file uploads (partial).
- Features we likely want to port next:
  - Project/worktree model (aliases, `@branch` routing, context footers).
  - Auto-router and engine registry (if we add multi-engine support).
  - Plugin system hooks (or MCP-based extensions) with thread/sender context.
  - File transfer send-back (zip or individual files).
  - Message overflow split mode and chat session auto-resume.

## Codex SDK / app-server notes (bidirectional bridge)

### Codex SDK (TypeScript)

- Package: `@openai/codex-sdk`.
- Wraps the bundled `codex` binary and exchanges JSONL events over stdin/stdout.
- API: `Codex.startThread()` / `resumeThread()`; `run()` for buffered results and `runStreamed()` for streaming items.
- Threads persist in `~/.codex/sessions` and can be resumed via thread id.
- This is still per-run process execution under the hood (spawn per turn).

### Codex app-server (bidirectional JSON-RPC)

- `codex app-server` is a CLI subcommand that powers the VS Code extension.
- Protocol: JSON-RPC 2.0 (header omitted), streaming JSONL over stdio.
- Supports `thread/start`, `thread/resume`, `thread/fork`, `turn/start`, `turn/interrupt`, `command/exec`, and more.
- Emits streaming notifications like `item/started`, `item/agentMessage/delta`, `item/completed`, `turn/completed`.
- Approval flow is server-initiated JSON-RPC requests:
  - `item/commandExecution/requestApproval` with `{ decision: "accept" | "decline" }` responses.
  - `item/fileChange/requestApproval` with the same response shape.
- Schema generation available: `codex app-server generate-ts` and `generate-json-schema`.

### Why this matters for a bidirectional Telegram bridge

- The app-server is explicitly bidirectional and long-running: we can keep a persistent Codex process in a container and stream events to the DO, while the DO sends JSON-RPC requests back (new messages, approval decisions, turn interrupts).
- This maps cleanly onto Telegram workflows: `/cancel` becomes `turn/interrupt`, approvals can be proxied as inline buttons, and chat sessions can map to `threadId` without restarting `codex exec` every turn.
- The generated TypeScript schema could let us type the protocol and validate messages without `any`.

