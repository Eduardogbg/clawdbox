# 109: Cloudflare Resource Quality Reset Plan

## Goal
Rebuild the Cloudflare resource implementation in `forks/alchemy-effect` to match maintainer quality (commit `13233970a6943f1c9b35f9a531d5a0727e5d11f5` as the baseline), avoid regressions like commit `eab9d2401e3954536f6f1796de9d90503b4ff51c`, and ensure D1 + Queue are first-class (Secrets Store is not the reference implementation).

## Plan
1. **Baseline & branch**
   - Create a clean branch from commit `13233970a6943f1c9b35f9a531d5a0727e5d11f5` in `forks/alchemy-effect`.
   - Record current Cloudflare-related diffs to understand what needs to be reworked or dropped.

2. **Audit for known bad changes (anti-examples)**
   - Restore/validate `alchemy-effect/src/cloudflare/config.ts` (should not be deleted).
   - Revert any non-standard Cloudflare configuration injected into `alchemy-effect/src/stage.ts` unless explicitly aligned with upstream.
   - Re-check `alchemy-effect/src/env.ts` for Cloudflare environment keys and ensure naming/usage matches upstream patterns.
   - Verify `alchemy-effect/src/cloudflare/worker/worker.provider.ts` for unnecessary type changes and revert to maintainer patterns.

3. **Re-implement Cloudflare resources using maintainer patterns**
   - Use D1 and Queue implementations from the maintainer baseline as the primary references.
   - Ensure Durable Objects are implemented as bindings only (no fake CRUD) unless upstream explicitly includes API operations.
   - Ensure Secrets Store is implemented as a normal resource (not the reference pattern) and uses SDK/fetch workarounds only when necessary and documented.
   - Follow provider guidance: `diff` returns `undefined` for in-place updates, and include service-specific attributes conditionally.

4. **Align with upstream PR #26**
   - Compare each Cloudflare resource and binding to the PR file layout (resources, providers, clients, index exports).
   - Ensure module structure, naming, exports, and binding policy modeling match the maintainer branch.

5. **Tests & idempotency**
   - Add/adjust provider tests for Cloudflare resources and ensure each test starts with `yield* destroy()`.
   - Prefer focused tests similar to `queue.provider.test.ts` and `table.provider.test.ts` patterns.
   - Avoid manual resource deletion; rely on tests being idempotent and self-healing.

6. **Quality gates**
   - Typecheck and lint the updated code.
   - Run targeted tests with `bun vitest run ./alchemy-effect/test/<path>/<test>.test.ts`.
   - Document any SDK workarounds with clear comments and links to Cloudflare API docs.

## Exit Criteria
- All Cloudflare resources compile, align with upstream patterns, and are free of ad-hoc config in core files.
- D1 and Queue providers/bindings mirror maintainer quality and are the reference style.
- Tests pass locally and remain idempotent.

## Notes
- No use of `Effect.catchAll`; use `Effect.catchTag`/`Effect.catchTags` only.
- Never delete `.alchemy/` or manually delete resources with the Cloudflare API/CLI.
