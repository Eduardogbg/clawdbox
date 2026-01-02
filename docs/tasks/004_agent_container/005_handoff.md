# Agent Container (Takopi) Handoff (005)

## Report

### What changed
- Added a dev environment deploy script for takopi that uses IaC for shared resources and wrangler for the container worker (`packages/iac/src/dev-environment.ts`).
- Wired new IaC scripts for dev up/down in `packages/iac/package.json`.
- Added takopi E2E (wrangler deploy + start + stop) and kept the takopi worker in the IaC stack (from prior step).
- Updated TODO tracking.

### How to use
- Deploy dev env (left running):
  - `cd packages/iac && bun run dev:env`
  - Optional `CLAWDBOX_DEV_TAG=dev-<name>` to control resource prefix.
- Destroy dev env:
  - `cd packages/iac && bun run dev:destroy`

### Output
- Script prints the takopi worker URL and a curl example to start a container instance.

## Next steps
1. Run the dev deploy script with real env vars and confirm the worker URL starts a container and responds to Telegram.
2. Consider adding SecretsStore reads inside the takopi Container DO so `/start` can omit sensitive data.
3. Decide whether to extend alchemy-effect to support container config to avoid wrangler usage for deploys.

## Commands Run
- `bun run typecheck`
