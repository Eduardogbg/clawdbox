# Agent Container (Takopi) Handoff (003)

## Scope
- Added takopi container image + entrypoint.
- Added takopi worker with Container DO + config helpers + tests.
- Updated IaC secrets, repo wiring, and root scripts.

## Changes Made
- `packages/takopi-container/Dockerfile`: Python + Node + Codex CLI + takopi install (git ref).
- `packages/takopi-container/entrypoint.sh`: writes takopi config, clones repo, runs takopi.
- `packages/takopi-container/README.md`: runtime env + build args.
- `packages/takopi-worker/*`: worker, container DO, config schema, tests, wrangler config.
- `packages/iac/src/alchemy.run.ts`: added takopi + OpenAI secrets.
- `packages/iac/src/deploy.ts`: added takopi + OpenAI secrets.
- `package.json`: include takopi-worker in typecheck/test.
- `tsconfig.json`: add takopi-worker reference.
- `TODO.md`: updated tasks + env vars.
- `.gitignore`: allow `forks/takopi`.
- `.gitmodules`: added takopi submodule.

## Commands Run
- `bun run typecheck`

## Notes / Follow-ups
- IaC still cannot deploy container workers because container image build/push is wrangler-only; takopi worker uses `wrangler.toml` for deployment.
- takopi container installs takopi from GitHub (`TAKOPI_REF` build arg). Keep this ref aligned with the `forks/takopi` submodule if you want deterministic builds.
- E2E for takopi still pending (start container, send Telegram message, stop).
