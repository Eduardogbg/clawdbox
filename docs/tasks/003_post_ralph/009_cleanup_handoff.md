# Post-Ralph Cleanup Handoff (009)

## Evaluation vs Spec

Target (from specs): Telegram-controlled agent orchestration on Cloudflare using Bun + Effect + alchemy-effect, with DO-based Operator, Workers for webhook and agent-worker, Containers for agent runtime, R2 repo snapshotting, and secret management. IaC should manage infra cleanly and E2E should deploy, send a Telegram message, and tear down.

Current state:
- IaC: alchemy-effect fork is integrated and used via a local tarball in `packages/iac`.
- Operator: Durable Object implementation exists with task/session/permission APIs.
- Telegram: Worker webhook handler implemented and tested.
- Agent runtime: agent-container + agent-worker code exists, but container deployment has not been fully validated.
- Secrets: Secrets Store resource implemented with a Cloudflare fetch helper due to SDK schema issues.
- E2E: a Telegram + Cloudflare E2E test now deploys Operator + Telegram workers, sets webhook, sends a message, and tears down all resources.
- Resource cleanup: no `clawdbox-*` resources found via API; R2 remains disabled in the account.

Gaps vs spec:
- Container deployment and agent runtime not yet fully exercised (Docker + Cloudflare Containers).
- R2 snapshot/restore is not working because R2 is not enabled.
- GitHub integration is not implemented.
- End-to-end flow does not yet include spawning an agent container from Operator; current E2E only verifies worker deploy + webhook + message.

## Key Changes in This Cleanup Track
- E2E test location: `packages/iac/test/telegram-e2e.test.ts` (guarded by `RUN_TELEGRAM_E2E=1` and a safe `CLAWDBOX_E2E_TAG`).
- Operator E2E tests now require `RUN_OPERATOR_E2E=1` to avoid hitting a stale URL.
- alchemy-effect fork fixes:
  - Cloudflare fetch helper for Secrets Store creation.
  - Worker `vars` + `migrations` support and `cloudflare:workers` bundling external.
  - Plan/apply support for DO namespace virtual bindings.
  - CLI service export to avoid Ink/vitest runtime during Bun tests.

## How to Run Tests
- IaC full run with Telegram E2E:
  - `RUN_TELEGRAM_E2E=1 bun test` (from `packages/iac`)
- Operator E2E against a deployed worker:
  - `RUN_OPERATOR_E2E=1 OPERATOR_URL=... bun test` (from `packages/iac`)

## Next Steps
1. Enable R2 in Cloudflare and re-run R2 tests.
2. Validate Docker + container deployment via agent-worker (Cloudflare Containers).
3. Add E2E that deploys operator + agent-worker and runs a real agent flow (spawn, permission, completion), then teardown.
4. Implement GitHub integration and R2 snapshot/restore logic.
5. Decide whether to keep Bun tests or return to vitest; Bun works now without `alchemy-effect/test`.

## Notes
- The IaC package depends on the local alchemy-effect tarball (currently `alchemy-effect-0.6.0-cli-service-planfix3.tgz`). Repack and bump the tarball filename to pick up fork changes.
- `CLAWDBOX_E2E_TAG` must begin with `e2e` or `test` or the E2E will refuse to run.
