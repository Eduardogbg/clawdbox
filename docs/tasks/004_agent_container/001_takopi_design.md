# Takopi + Cloudflare Containers Design (004)

## Intent
- Replace custom Telegram webhook flow with takopi running inside a Cloudflare Container.
- Keep existing telegram-webhook worker untouched for now.
- Use IaC to provision the container worker and required secrets.

## Context Summary
- The current stack already has an Agent Worker + Container DO pattern.
- alchemy-effect supports Container bindings, Worker resources, Secrets Store, KV, and D1.
- takopi is a Python CLI that long-polls Telegram and bridges messages to `codex exec --json`.

## Proposed Architecture

```
Telegram
  |
  | (long-polling via Bot API)
  v
Takopi Container (Cloudflare Containers)
  |
  | codex exec --json
  v
Repo Workspace (cloned at container start)
```

### Components
1. Takopi Container Image
   - Python 3.12 base image.
   - `takopi` installed from `forks/takopi` submodule (or PyPI once released).
   - `codex` CLI installed and available on PATH.
   - Entry script writes takopi config + optional codex config, clones repo, then runs `takopi`.

2. Takopi Worker + Container DO
   - Worker hosts `TakopiContainerDO extends Container`.
   - HTTP endpoints:
     - `POST /start` to start container with env vars.
     - `POST /stop` to stop container.
     - `GET /status` for container state.
   - DO persists minimal state (status, started_at, last_error) in SQLite.

3. IaC Stack Updates
   - Add Worker resource for takopi (container-enabled DO binding).
   - Bind Secrets Store for Telegram token and Codex/OpenAI API key.
   - Optionally add R2 for repo snapshotting later (not required for initial e2e).

## Container Runtime Contract

### Environment Variables (passed by DO on start)
- `TAKOPI_BOT_TOKEN` (secret)
- `TAKOPI_CHAT_ID` (secret)
- `CODEX_API_KEY` or `OPENAI_API_KEY` (secret, depends on codex CLI)
- `TAKOPI_REPO_URL` (public or PAT-authenticated)
- `TAKOPI_REPO_BRANCH` (default: main)
- `TAKOPI_WORKDIR` (default: /workspace/repo)
- `CODEX_PROFILE` (optional, maps to ~/.codex/config.toml)

### Entrypoint Steps
1. Create `~/.codex/takopi.toml` with bot token + chat id.
2. Optionally write `~/.codex/config.toml` with profile + trusted dirs.
3. Clone repo into `TAKOPI_WORKDIR` (use `GITHUB_PAT` if needed).
4. `cd` into repo and run `takopi --profile $CODEX_PROFILE`.

## IaC Sketch (Pseudo)
```
const TakopiContainer = Cloudflare.Container.Container("TakopiContainer", {
  className: "TakopiContainerDO",
  maxInstances: 1,
  instanceType: "basic",
});

const TakopiWorker = Cloudflare.Worker("TakopiWorker", {
  name: "clawdbox-takopi",
  main: "packages/takopi-worker/src/index.ts",
  bindings: $(Cloudflare.Container.Bind(TakopiContainer), Cloudflare.SecretsStore.Bind(Secrets)),
  migrations: [{ tag: "v1", new_sqlite_classes: ["TakopiContainerDO"] }],
});
```

## E2E Flow (Target)
1. IaC deploys takopi worker + container binding.
2. `POST /start` starts container with repo + secrets.
3. Send Telegram message; takopi polls and answers.
4. `POST /stop` terminates container.
5. IaC destroy removes resources.

## Risks / Open Questions
- Codex CLI trusted directory requirement (need to pre-seed config or env override).
- Long-polling and container sleep behavior (must keep container alive).
- Single instance per bot token; need serialization in DO to prevent multiple starts.
- Ephemeral filesystem: resume only works while container stays alive; snapshotting deferred.

## Next Implementation Steps
1. Create `packages/takopi-container` with Dockerfile + entrypoint.
2. Create `packages/takopi-worker` with Container DO + start/stop/status.
3. Extend IaC stack to deploy takopi worker + container binding.
4. Add takopi E2E test guarded by `RUN_TAKOPI_E2E=1`.
