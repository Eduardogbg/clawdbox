# Takopi Container

Docker image for running takopi inside Cloudflare Containers.

## Environment Variables

Required:
- `TAKOPI_BOT_TOKEN`
- `TAKOPI_CHAT_ID`
- `TAKOPI_REPO_URL`

Optional:
- `TAKOPI_REPO_BRANCH` (default: `main`)
- `TAKOPI_WORKDIR` (default: `/workspace/repo`)
- `TAKOPI_FINAL_NOTIFY` (`true`/`false`, default: `true`)
- `TAKOPI_DEBUG` (`true`/`false`, default: `false`)
- `CODEX_PROFILE` (passed to `takopi --profile`)
- `TAKOPI_CODEX_CONFIG_TOML` (contents for `~/.codex/config.toml`)
- `GITHUB_PAT` (used for cloning private repos)
- `OPENAI_API_KEY` (Codex CLI auth, if required)

## Build Args

- `NODE_VERSION` (default: `20`)
- `TAKOPI_REF` (git ref for `takopi` install, default: `main`)
