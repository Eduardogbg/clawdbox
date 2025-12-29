# Post-Ralph Cleanup Handoff (Tests)

## Scope
- Fixed IaC test context typing to avoid `any`/internal CLI references.
- Added cleanup finalizers for IaC integration tests.

## Changes Made
- `packages/iac/test/setup.ts`: typed `createTestContext` (now `Layer.Layer<... , PlatformError>`), using public CLI type.
- `packages/iac/test/{secrets-store,d1,kv,queue,r2-bucket,worker}.test.ts`: wrap test programs with `Effect.ensuring(destroy())` and use `pipe` for chaining.

## Commands Run
- `bun run typecheck`
- `cd packages/iac && bun test test/container.test.ts`

## Test Results
- Typecheck: PASS (all packages).
- IaC container test: PASS (Docker + wrangler available).

## Notes / Follow-ups
- IaC integration tests still require live Cloudflare credentials; cleanup now runs even if assertions fail.
- R2/Queues tests remain gated by service availability and env flags.
