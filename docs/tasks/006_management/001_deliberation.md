# Management Design Deliberation (006)

## Goals
- Provide a canonical settings topic in Telegram for admin commands.
- Introduce a manager worker/DO with relational-ish storage for accounts, tokens, and usage metadata.
- Support CLI-driven onboarding: user pastes Codex/OpenAI key + Cloudflare token.
- Enable per-tenant deployment tracking and visibility into running sessions/containers.

## Key constraints
- Telegram supports only one webhook per bot, so the management flow must live in the same worker or be proxied from the main worker.
- Cloudflare Workers cannot run Docker or wrangler; IaC deploys must run from a CLI or external service.

## Decisions
- Skip Cloudflare Workflows for now; webhook is the primary control path.
- No queue layer yet; rely on DO queue with bounded size and add queues later if needed.
- Avoid Telegram framework dependencies; call the Bot API directly with typed schemas.

## Proposed architecture

### 1) Manager DO (SQLite)
Tables:
- accounts(id, chat_id, settings_thread_id, created_at)
- credentials(account_id, codex_api_key, cloudflare_api_token, cloudflare_account_id, created_at)
- deployments(account_id, stage, worker_url, image_ref, created_at)
- sessions(account_id, chat_key, session_id, started_at, last_event_at, status)

### 2) Routing & settings thread
- Main worker receives Telegram updates.
- If the message arrives in a settings topic (settings_thread_id for that chat), route to Manager DO.
- Otherwise route to Orchestrator DO.
- `/settings` in a topic sets the settings_thread_id for that chat.
- `/auth` starts an interactive onboarding flow (Cloudflare account id → API token → Codex key).

### 3) CLI onboarding flow
- CLI collects Codex API key and a Cloudflare deployer token.
- CLI calls Manager worker `/cli/register` with a pre-shared CLI token, storing credentials.
- CLI runs `dev:env` locally using the user-provided Cloudflare token + account id.
- Manager DO stores deployment metadata (worker URL, image ref).

### 4) Token creation
- Use the bootstrap token from `docs/references/CLOUDFLARE.md` to create a scoped deployer token.
- Required permissions (account-scoped):
  - Workers Scripts Write
  - Workers Containers Write
  - Workers KV Storage Write
  - Workers R2 Storage Write
  - Secrets Store Write
  - D1 Write
  - Workers Tail Read
  - Account Settings Read

## Open questions
- Should `/new` in the settings topic be treated as a session reset for the Manager DO or ignored?
- Do we need per-user settings within a group chat, or is per-chat sufficient for now?
- Should the manager DO be a new worker package or embedded in the existing agent worker?

## Next steps
1) Implement Manager DO schema + endpoints (`/cli/register`, `/settings/set`, `/usage`).
2) Add routing in agent worker for settings topic vs agent topic.
3) Add a CLI script for onboarding and deployment (using `packages/iac/src/dev-environment.ts`).
