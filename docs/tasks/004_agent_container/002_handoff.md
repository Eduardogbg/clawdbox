# Agent Container (Takopi) Handoff

## Scope
- Switched takopi clone under `forks/` to a git submodule.
- Drafted the takopi + Cloudflare Containers design spec.
- Updated TODO for the new takopi-focused plan.

## Changes Made
- `.gitignore`: allowed `forks/takopi` to be tracked.
- `.gitmodules`: added takopi submodule.
- `forks/takopi`: now a git submodule pointing to https://github.com/banteg/takopi.
- `docs/tasks/004_agent_container/001_takopi_design.md`: architecture + IaC sketch.
- `TODO.md`: added 004 agent container tasks.

## Commands Run
- `git submodule add https://github.com/banteg/takopi forks/takopi`
- `bun run typecheck`

## Next Steps
1. Create `packages/takopi-container` (Dockerfile + entrypoint that writes takopi config and clones repo).
2. Create `packages/takopi-worker` with a Container DO (start/stop/status).
3. Extend IaC stack to deploy the takopi worker + container binding.
4. Add takopi E2E (deploy, start, send Telegram message, stop, destroy).

## Notes
- takopi config is file-based (`~/.codex/takopi.toml`); container entrypoint must generate it from secrets.
- Codex CLI trusted directory requirement may need pre-seeding in the image or at runtime.
