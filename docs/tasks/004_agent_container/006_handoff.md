# Handoff 006 - Takopi Crane Automation

## What Changed
- Added crane-based image build/push flow in `packages/iac/src/dev-environment.ts`, including Cloudflare registry credential minting and `wrangler.toml` image override.
- Added shared `packages/iac/src/wrangler-config.ts` helper to create temporary `wrangler.toml` overrides for a specific container image.
- Updated takopi E2E to accept `TAKOPI_IMAGE` (skip Docker build/push and deploy using a prebuilt registry image).
- Updated `packages/iac/.env` with `TAKOPI_BOT_TOKEN`, `TAKOPI_CHAT_ID`, and `TELEGRAM_BOT_TOKEN` derived from `telegram.json`.

## Registry Debug Notes
- Cloudflare registry credentials now require a JSON body with `permissions: ["pull","push"]` and `expiration_minutes`.
- `crane copy alpine:3.19` to `registry.cloudflare.com/<account>/takopi-crane-smoke:latest` succeeds; Docker push still fails.
- `crane ls` fails due to Cloudflare’s malformed Link header; `crane manifest <image>:tag` works.

## How To Run
- Deploy dev env with automated build/push:
  - `cd packages/iac && bun run dev:env`
- Skip build/push if you already have an image:
  - Set `TAKOPI_IMAGE=registry.cloudflare.com/<account>/<repo>:<tag>` in `packages/iac/.env`
  - Then run `bun run dev:env`
- Start container after deploy using the `curl` command printed by the script.

## New/Updated Env Vars
- `TAKOPI_IMAGE` (optional, skip build/push and use prebuilt image)
- `TAKOPI_IMAGE_REPO` (optional, default `clawdbox-takopi`)
- `TAKOPI_IMAGE_TAG` (optional, default derived from dev tag)
- `TAKOPI_IMAGE_PLATFORM` (optional, default `linux/amd64`)
- `TAKOPI_REF` (optional, default `master`)
- `TAKOPI_REGISTRY_TTL_MINUTES` (optional, default `60`)

## Next Steps
- Run `bun run dev:env` and confirm container starts via `/takopi/<id>/start`.
- If deploying from a prebuilt image, confirm E2E runs with `RUN_TAKOPI_E2E=1` + `TAKOPI_IMAGE=...`.
- Decide whether to keep the `takopi-crane-smoke` image or clean it up.
