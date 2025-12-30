# alchemy-effect testing in clawdbox

This document explains how the IaC tests were structured when I found them, why vitest showed up, how alchemy-effect's testing helpers work, and how the tests are wired now.

## What I found

- The repo was already using `bun:test` across packages, but the IaC test setup (`packages/iac/test/setup.ts`) imported `testCLI` from `alchemy-effect/test`.
- `alchemy-effect/test` internally imports `@effect/vitest` (and its test runner helpers), which in turn expects the vitest runtime module (`test`) to exist.
- As a result, `bun test` failed with errors like:
  - `Cannot find package 'test' from @effect/vitest ...`
  - `Cannot find module 'react/jsx-dev-runtime' ...` (due to CLI/Ink loading when importing the CLI module)

Net effect: we were not running vitest, but we were *accidentally loading* vitest via `alchemy-effect/test`, which broke the bun test runner.

## How alchemy-effect testing works

In the alchemy-effect codebase:

- `alchemy-effect/test` exports a `test()` helper built on `@effect/vitest`.
- That helper creates a scoped Effect runtime with:
  - a local app/stage config (`App.make(...)`)
  - a state store (local FS or in-memory)
  - a CLI layer (`testCLI`) that auto-approves plans
  - platform layers (NodeContext, FetchHttpClient)
- The helper ultimately calls `it.scopedLive(...)` from `@effect/vitest`, so it *must* be run under vitest.

In other words: alchemy-effect's built-in test helper is vitest-centric by design.

## How it was used here

In this repo, the IaC tests did not use `alchemy-effect/test.test()` directly. The only thing we pulled from `alchemy-effect/test` was `testCLI`, purely to avoid importing the Ink CLI (and to auto-approve plans). That import still executed the module and dragged in `@effect/vitest`.

So the dependency was indirect:

- `packages/iac/test/setup.ts` -> `alchemy-effect/test` -> `@effect/vitest` -> vitest runtime

Even though tests themselves were `bun:test`, the load path required vitest.

## Current wiring in this codebase

We removed all runtime reliance on vitest while keeping the Effect-based IaC flow intact:

- `packages/iac/test/setup.ts` now defines a local `testCLI` layer (copied from alchemy-effect's test helper), and imports the CLI tag from `alchemy-effect/cli/service`.
- We avoid `alchemy-effect/test` completely, so `@effect/vitest` is no longer loaded at runtime.
- `alchemy-effect/cli/service` is exported as a subpath to avoid pulling in the Ink CLI implementation.
- `bun:test` runs all IaC tests, and the E2E test uses `apply(...)`/`destroy()` just like before.

This preserves the same resource lifecycle behavior (plan/apply/destroy) while keeping the test runner Bun-native.

## If we decide to go back to vitest

Two paths:

1) Use `alchemy-effect/test.test()` directly and run tests with vitest.
2) Keep Bun tests and continue using the local `testCLI` layer (the current approach).

The key point: using `alchemy-effect/test` *always* implies vitest, because it relies on `@effect/vitest`.

## Key files

- `packages/iac/test/setup.ts` (current local test context + testCLI)
- `forks/alchemy-effect/alchemy-effect/src/test.ts` (the vitest-based helper)
- `forks/alchemy-effect/alchemy-effect/src/cli/service.ts` (CLI tag without Ink)
