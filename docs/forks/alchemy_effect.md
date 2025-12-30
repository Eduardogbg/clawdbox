# alchemy-effect fork 

This documents the current fork usage in clawdbox and the local changes made to alchemy-effect.

## Are we depending on the local fork?

Yes. The IaC package depends on the locally packed tarball from the fork:

- `packages/iac/package.json`:
  - `alchemy-effect`: `../../forks/alchemy-effect/alchemy-effect/alchemy-effect-0.6.0-cli-service-planfix3.tgz`
- `bun.lock` pins that tarball path.

That means edits in `forks/alchemy-effect` only take effect after running `bun pm pack` and reinstalling (the tarball is the artifact actually consumed by the repo).

## Why this fork exists (short)

We needed Cloudflare resources and testability that upstream alchemy-effect does not yet provide cleanly for this codebase. We also had to work around Cloudflare SDK/schema issues and avoid vitest/Ink runtime dependencies in Bun tests.

## Changes in the fork (summary)

### 1) Cloudflare Secrets Store fetch helper
- Added a fetch helper for Cloudflare API calls and used it in the Secrets Store provider, since the Cloudflare SDK schema is wrong for store creation.
- This avoids the API’s `invalid_json_body` error and keeps Secrets Store tests passing.

Refs:
- `forks/alchemy-effect/alchemy-effect/src/cloudflare/fetch.ts`
- `forks/alchemy-effect/alchemy-effect/src/cloudflare/secrets-store/store.provider.ts`
- `forks/alchemy-effect/alchemy-effect/src/cloudflare/index.ts`

### 2) Worker vars + migrations support
- Added `vars` and `migrations` support in Cloudflare worker props/provider.
- Enables passing plain text bindings (`plain_text`) and DO migrations in alchemy-effect without wrangler.

Refs:
- `forks/alchemy-effect/alchemy-effect/src/cloudflare/worker/worker.ts`
- `forks/alchemy-effect/alchemy-effect/src/cloudflare/worker/worker.provider.ts`

### 3) Avoid vitest/Ink in Bun tests
- Exported `alchemy-effect/cli/service` as a subpath so tests can import the CLI tag without loading Ink.
- IaC tests use a local `testCLI` layer instead of `alchemy-effect/test` to avoid `@effect/vitest` at runtime.

Refs:
- `forks/alchemy-effect/alchemy-effect/package.json`
- `packages/iac/test/setup.ts`

### 4) Fix plan/apply for DO namespace bindings (virtual resources)
- Plan now filters non-resource capability sources.
- Apply now tolerates binding sources that are “virtual” (like DO namespace bindings) without requiring a resource plan node.

Refs:
- `forks/alchemy-effect/alchemy-effect/src/plan.ts`
- `forks/alchemy-effect/alchemy-effect/src/apply.ts`

### 5) Bundling fix for `cloudflare:workers`
- esbuild now treats `cloudflare:workers` as external during worker bundling.
- Fixes bundle failure when compiling DO classes.

Ref:
- `forks/alchemy-effect/alchemy-effect/src/cloudflare/worker/worker.provider.ts`

## What these changes enabled

- `RUN_TELEGRAM_E2E=1 bun test` in `packages/iac` now passes, including:
  - deploy of Operator + Telegram workers
  - webhook setup
  - Telegram message send
  - teardown (`destroy()`)
- IaC tests no longer fail due to vitest runtime errors.
- DO bindings can be used in workers without crashing the plan/apply pipeline.

## Repacking workflow

1) Modify code under `forks/alchemy-effect/alchemy-effect`.
2) Run `bun pm pack` there.
3) Copy the tarball to a new filename (e.g. `alchemy-effect-0.6.0-cli-service-planfix3.tgz`).
4) Update `packages/iac/package.json` to point at the new tarball.
5) Run `bun install` at repo root (and optionally inside `packages/iac`).

This forces Bun to pick up the new tarball content.
