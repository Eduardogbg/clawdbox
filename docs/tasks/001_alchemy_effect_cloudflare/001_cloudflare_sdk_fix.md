# Handoff: Cloudflare SDK Secrets Store Fix

## Goal
Add Secrets Store support to `alchemy-effect` (IaC library) and fix the Cloudflare SDK bug blocking its use.

## What Was Done

### 1. Secrets Store Implementation in alchemy-effect
Added full Secrets Store resource support to `alchemy-effect` at `/Users/eduardo/workspace/alchemy-effect/alchemy-effect/src/cloudflare/secrets-store/`:
- `store.ts` - Resource definition
- `store.provider.ts` - CRUD provider (with workaround for SDK bug)
- `store.binding.ts` - Worker binding
- `index.ts` - Exports

Registered in `live.ts` and exported from `cloudflare/index.ts`.

### 2. Discovered Cloudflare SDK Bug
The SDK's `secretsStore.stores.create()` method fails because:
- **OpenAPI spec** (`cloudflare/api-schemas`) defines request body as `type: array`
- **SDK** sends `body: [{name: "..."}]` (array format)
- **Actual API** rejects arrays with `400 invalid_json_body` (code 1001)
- **API only accepts** single object `{name: "..."}`

### 3. Created Reproduction Package
Location: `packages/repro-sdk-bug/`

```bash
bun run repro        # Direct fetch - shows array fails, object works
bun run repro:sdk    # Original SDK - fails with invalid_json_body
bun run repro:sdk-fixed  # Fixed SDK - works correctly
```

### 4. Fixed Both Repos Locally
Cloned to `forks/` (gitignored):

**api-schemas** (`fix/secrets-store-create-body` branch):
- Changed POST `/accounts/{account_id}/secrets_store/stores` request body from array to single object
- Changed response from collection to single store response

**cloudflare-typescript** (`fix/secrets-store-create-body` branch):
- Changed `StoreCreateParams` from `{ account_id, body: Array<{name}> }` to `{ account_id, name }`
- Changed return type from `PagePromise` to `APIPromise<StoreCreateResponse>`
- Removed `StoreCreateResponsesSinglePage` class and exports

### 5. Built Fixed SDK
The SDK has a complex build system requiring isolation from bun-types. Built in `/tmp` and copied back:
```bash
cp -rp forks/cloudflare-typescript /tmp/cloudflare-typescript-build
cd /tmp/cloudflare-typescript-build
rm -rf node_modules && npm install && ./scripts/build
cp -rp /tmp/cloudflare-typescript-build forks/cloudflare-typescript
```

The built SDK can be used as a local dependency:
```json
{ "cloudflare-fixed": "file:../../forks/cloudflare-typescript" }
```

## Issues & Workarounds

### 1. SDK Build Fails in Workspace
**Issue:** `tsc-multi` picks up `bun-types` from parent `node_modules`, causing parse errors on newer TS syntax.
**Workaround:** Build SDK in `/tmp` outside the bun workspace, then copy back.

### 2. alchemy-effect Provider Workaround
**Location:** `alchemy-effect/src/cloudflare/secrets-store/store.provider.ts`
**Issue:** Can't use SDK for store creation due to the bug.
**Workaround:** Uses direct `fetch()` with single object body instead of SDK.
```typescript
// WORKAROUND: Cloudflare SDK expects array body but API rejects it.
const response = yield* Effect.tryPromise({
  try: async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, ... },
      body: JSON.stringify({ name: storeName }), // Single object, not array
    });
    ...
  },
});
```

### 3. Pre-existing Type Errors in PR #26
Fixed several issues in the `feat/cloudflare-d1-queue-do` branch:
- `queue.provider.ts` - Fixed async iteration (yield Effect before collectPages)
- `namespace.binding.ts` - Cast source to Namespace type
- `database.provider.ts` - Cast location hint to union type
- `worker.provider.ts` - Cast File to Uploadable
- `env.ts` - Fixed cloudflare:workers import
- `stage.ts` - Added cloudflare config to StageConfig

## What's Next

### Option A: Submit Upstream PRs
1. Fork `cloudflare/api-schemas` on GitHub
2. Push `fix/secrets-store-create-body` branch
3. Open PR with repro demonstrating the bug

4. Fork `cloudflare/cloudflare-typescript` on GitHub
5. Push `fix/secrets-store-create-body` branch
6. Open PR (may auto-regenerate from api-schemas fix)

### Option B: Use Local Fixed SDK in alchemy-effect
1. Update `alchemy-effect` to depend on the local fixed SDK
2. Remove the fetch workaround in `store.provider.ts`
3. Use proper SDK method:
```typescript
const store = yield* api.secretsStore.stores.create({
  account_id: accountId,
  name: storeName,
});
```

### Option C: Keep Workaround Until Upstream Fix
The current fetch-based workaround in `store.provider.ts` works. Can keep it until Cloudflare fixes the SDK, then remove.

## Key Files
- Repro: `packages/repro-sdk-bug/`
- Fixed SDK: `forks/cloudflare-typescript/`
- Fixed OpenAPI: `forks/api-schemas/`
- Secrets Store impl: `alchemy-effect/src/cloudflare/secrets-store/`
- Provider with workaround: `alchemy-effect/src/cloudflare/secrets-store/store.provider.ts`

## Credentials
- Account ID: `3a16620c57b98731f762586aeed4f25c` (in alchemy state)
- Token creation token: See `docs/references/CLOUDFLARE.md`
- Repro uses `.env` in `packages/repro-sdk-bug/` (gitignored)
