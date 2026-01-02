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
- `TAKOPI_DEBUG_TELEGRAM` (`true`/`false`, default: `false`, sends Telegram API debug summary)
- `TAKOPI_DEBUG_ARGS` (`true`/`false`, default: `false`, sends codex arg debug payload to Telegram)
- `TAKOPI_ALLOW_GROUP` (`true`/`false`, default: `false`)
- `TAKOPI_DELETE_WEBHOOK` (`true`/`false`, default: `true`)
- `TAKOPI_STRIP_COMMANDS` (`true`/`false`, default: `true`)
- `TAKOPI_CODEX_ARGS` (extra `codex` CLI args, default: `--dangerously-bypass-approvals-and-sandbox`)
- `TAKOPI_LOG_SERVER` (`true`/`false`, default: `true` when `TAKOPI_DEBUG=true`)
- `CODEX_PROFILE` (passed to `takopi --profile`)
- `TAKOPI_CODEX_CONFIG_TOML` (contents for `~/.codex/config.toml`)
- `GITHUB_PAT` (used for cloning private repos)
- `OPENAI_API_KEY` (Codex CLI auth, if required)
- `CODEX_API_KEY` (alias for Codex CLI auth)

## Build Args

- `NODE_VERSION` (default: `20`)
- `TAKOPI_REF` (git ref for `takopi` install, default: `8eda3f5e84f960e6961ee1e05ae24a23752e16e7`)
