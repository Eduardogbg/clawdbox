# Handoff: Takopi feature audit + Codex app-server notes

Context:
- Documented upstream takopi changes since our pinned `v0.1.0-8` and summarized Codex SDK/app-server capabilities.
- See the report at `docs/tasks/007_takopi_feature_audit/000_report.md`.

If you pick this up:
- Decide which takopi features to port next (projects/worktrees, file transfer back, message overflow split, chat session auto-resume).
- Evaluate whether `codex app-server` (JSON-RPC over stdio) can replace `codex exec` in the container for a bidirectional bridge.
- If yes, generate TypeScript schema via `codex app-server generate-ts` and add Effect schema validation around it.

