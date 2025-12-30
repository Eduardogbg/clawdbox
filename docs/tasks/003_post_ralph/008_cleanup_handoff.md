# Post-Ralph Cleanup Handoff (008)

## Summary
- Telegram + Cloudflare E2E now lives in `packages/iac/test/telegram-e2e.test.ts` with a safe tag guard (`CLAWDBOX_E2E_TAG` must start with `e2e` or `test`).
- IaC tests no longer import `alchemy-effect/test` or `alchemy-effect/cli` (ink/vitest); they use a local `testCLI` layer and `alchemy-effect/cli/service`.
- alchemy-effect fork patched for DO virtual resources and worker bundling:
  - plan filters non-resource binding capabilities (`isResource`)
  - apply handles virtual binding sources (e.g., DO namespace) without failing
  - esbuild marks `cloudflare:workers` as external
- Operator E2E tests now guarded by `RUN_OPERATOR_E2E=1`.

## Key Changes
- `packages/iac/test/telegram-e2e.test.ts`: safe tag guard + layer order fix.
- `packages/iac/test/setup.ts`: local `testCLI` and `CLI` import from `alchemy-effect/cli/service`.
- `packages/iac/test/operator-e2e.test.ts`: gated by `RUN_OPERATOR_E2E`.
- `forks/alchemy-effect/alchemy-effect/src/plan.ts`: skip non-resource capability sources.
- `forks/alchemy-effect/alchemy-effect/src/apply.ts`: allow virtual binding sources.
- `forks/alchemy-effect/alchemy-effect/src/cloudflare/worker/worker.provider.ts`: externalize `cloudflare:workers` in esbuild.
- `forks/alchemy-effect/alchemy-effect/package.json`: added `./cli/service` export.
- `packages/iac/package.json`: alchemy-effect now points at `alchemy-effect-0.6.0-cli-service-planfix3.tgz`.

## Tests Run
- `RUN_TELEGRAM_E2E=1 bun test` in `packages/iac`
  - Telegram + Cloudflare E2E passed (deploy + webhook + message + teardown)
  - D1/KV/Worker/SecretsStore tests passed
  - R2/Queue skipped (R2 not enabled)

## Infra Check
- Cloudflare API check showed no `clawdbox-*` resources in the current account; R2 still disabled.

## Notes / Next Steps
- If you need Operator E2E against a deployed worker: set `RUN_OPERATOR_E2E=1` and `OPERATOR_URL=...`.
- If you want to stop the e2e tag guard, update `CLAWDBOX_E2E_TAG` (currently enforced).
- If you change alchemy-effect again, bump the tarball filename to force bun to reinstall.
