# 106: Resource Patching Plan for Alchemy-Effect Standards

## Summary

Based on findings from 104, this plan addresses patching Cloudflare resources in our local fork to better suit alchemy-effect standards. The key insight is that SDK bugs should be bypassed using raw `fetch()` with proper documentation, while keeping the fork as a fallback.

---

## Current State Analysis

### Fork Changes (from upstream main)
```
alchemy-effect/src/cloudflare/d1/            # D1 Database (new)
alchemy-effect/src/cloudflare/queue/         # Queues (new)
alchemy-effect/src/cloudflare/durable-object/ # Durable Objects (new)
alchemy-effect/src/cloudflare/secrets-store/  # Secrets Store (new)
```

### SDK Usage Audit

| Resource | SDK Status | Notes |
|----------|-----------|-------|
| D1 Database | Working | Uses `api.d1.database.*` |
| Queue | Working | Uses `api.queues.*` |
| Durable Object | N/A | Binding only, no CRUD API |
| Secrets Store | **BUGGY** | `createStore` uses raw fetch workaround |
| KV Namespace | Working | Uses `api.kv.namespaces.*` |
| R2 Bucket | Working | Uses `api.r2.buckets.*` |
| Worker | Working | Uses `api.workers.*` |

### Secrets Store SDK Bug (store.provider.ts:50-84)

The Cloudflare SDK sends an array body for store creation, but the API rejects arrays:
```typescript
// SDK types show: body: Array<{name: string}>
// API actually requires: {name: string}
```

---

## Patching Strategy

### Phase 1: Standardize Fetch Workaround Pattern

Create a reusable fetch utility that follows alchemy-effect patterns:

```typescript
// src/cloudflare/fetch.ts
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { CLOUDFLARE_API_TOKEN } from "./api.ts";
import { Account } from "./account.ts";

export class CloudflareFetchError extends Data.Error<{
  _tag: "CloudflareFetchError";
  status: number;
  message: string;
  errors: Array<{ code: number; message: string }>;
}> {}

export const cloudflareFetch = <T>(options: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}) =>
  Effect.gen(function* () {
    const apiToken = yield* CLOUDFLARE_API_TOKEN.pipe(
      Effect.map(Option.getOrThrow),
    );
    const accountId = yield* Account;

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}${options.path}`;

    const response = yield* Effect.tryPromise({
      try: async () => {
        const res = await fetch(url, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        });

        const data = await res.json() as {
          success: boolean;
          result: T;
          errors: Array<{ code: number; message: string }>;
        };

        if (!data.success) {
          throw { status: res.status, errors: data.errors };
        }

        return data.result;
      },
      catch: (error) => {
        if (typeof error === "object" && error !== null && "status" in error) {
          return new CloudflareFetchError({
            _tag: "CloudflareFetchError",
            status: (error as any).status,
            message: `Cloudflare API error`,
            errors: (error as any).errors ?? [],
          });
        }
        return new CloudflareFetchError({
          _tag: "CloudflareFetchError",
          status: 0,
          message: String(error),
          errors: [],
        });
      },
    });

    return response;
  });
```

### Phase 2: Refactor Secrets Store Provider

Update `store.provider.ts` to use the standardized fetch utility:

```typescript
// Before (inline fetch)
const response = yield* Effect.tryPromise({
  try: async () => {
    const res = await fetch(...);
    // 30+ lines of fetch logic
  },
});

// After (using utility)
const store = yield* cloudflareFetch<StoreResponseObject>({
  method: "POST",
  path: "/secrets_store/stores",
  body: { name: storeName },
});
```

### Phase 3: Document All SDK Workarounds

Each workaround should have:
1. Comment explaining the bug
2. Link to Cloudflare API docs
3. TODO marker for removal when upstream fixes land

```typescript
// WORKAROUND: Cloudflare SDK sends array body, API rejects it
// See: https://developers.cloudflare.com/api/resources/secrets_store/
// TODO: Remove when cloudflare-node SDK fixes body serialization
```

---

## Resources to Patch

### 1. Secrets Store (Priority: High)
- **File:** `secrets-store/store.provider.ts`
- **Issue:** `createStore` uses inline fetch
- **Action:** Refactor to use `cloudflareFetch` utility
- **SDK Operations:**
  | Operation | SDK Works? | Action |
  |-----------|-----------|--------|
  | create | No | Use `cloudflareFetch` |
  | list | Yes | Keep SDK |
  | delete | Yes | Keep SDK |
  | secrets.create | Yes | Keep SDK |
  | secrets.list | Yes | Keep SDK |
  | secrets.delete | Yes | Keep SDK |

### 2. D1 Database (Priority: Low)
- **File:** `d1/database.provider.ts`
- **Status:** SDK works correctly
- **Action:** No changes needed

### 3. Queue (Priority: Low)
- **File:** `queue/queue.provider.ts`
- **Status:** SDK works correctly
- **Action:** No changes needed

### 4. Durable Object (Priority: N/A)
- **File:** `durable-object/namespace.ts`
- **Status:** Binding only, no API calls
- **Action:** No changes needed

---

## Fork Strategy

### Why Keep the Fork

Even though the main change is just the Secrets Store workaround:
1. **Future SDK bugs:** Easy to add more workarounds
2. **Quick iteration:** Don't need to wait for upstream PRs
3. **Testing ground:** Validate changes before submitting PRs

### Fork Maintenance

```
clawdbox/
  alchemy-effect -> ../alchemy-effect/  # Symlink to fork

alchemy-effect/  # Fork repository
  main branch: tracks upstream
  feature branches: our additions
```

### Syncing with Upstream

```bash
cd alchemy-effect
git fetch origin
git rebase origin/main  # or merge if preferred
```

---

## Implementation Tasks

1. [ ] Create `src/cloudflare/fetch.ts` utility
2. [ ] Refactor `store.provider.ts` to use fetch utility
3. [ ] Add comprehensive error handling with `CloudflareFetchError`
4. [ ] Add workaround documentation comments
5. [ ] Run typecheck: `bun x tsc --noEmit`
6. [ ] Test Secrets Store CRUD operations
7. [ ] Verify D1, Queue, Durable Object still work

---

## Validation Checklist

- [ ] `cloudflareFetch` returns proper Effect types
- [ ] Error types are discriminated unions
- [ ] No `any` types used
- [ ] Functional patterns preferred (no loops)
- [ ] Dependencies are injectable via Effect Context
- [ ] Resource patterns follow alchemy-effect conventions

---

## Impact on clawdbox

Minimal changes needed since the symlink already points to the fork:
- Package resolution unchanged
- Import paths unchanged
- Just need to run `bun install` if dependencies change

---

## Next Steps

After this plan is approved:
1. Implement the `cloudflareFetch` utility (107)
2. Refactor Secrets Store provider (108)
3. Test end-to-end deployment (109)
