# 104: Itty Status & Cloudflare Contribution Guide

## 1. Itty-AWS Status

### Current State
- **Version in use:** `itty-aws@0.8.10`
- **Status:** Actively used for all AWS resources in alchemy-effect
- **Location:** AWS implementations at `alchemy-effect/src/aws/`

### Why Not Rolled Out for Cloudflare Yet

From the Discord excerpt (102), Pear explained:

> "after the aws sdk we are going to look into generating a better cloudflare sdk"

The Alchemy team's SDK generation strategy:
1. **Phase 1 (current):** itty-aws based on AWS Smithy models
2. **Phase 2 (in progress):** itty-aws v2 with proper generated SDK
3. **Phase 3 (future):** Generated Cloudflare SDK using similar approach

Key quote:
> "the only realistic solution for how many providers alchemy would like to handle is to generate sdks based on whatever we can and then use some kind of patch system to fix schemas/errors/etc that aren't correct."

### Itty-AWS Architecture

The current itty-aws integration in alchemy-effect:
- `createAWSServiceClientLayer` wraps itty-aws clients with Effect
- Automatic retry with exponential backoff for throttling
- All methods converted from Promises to Effects
- Credentials wrapped with `Redacted<string>` for security

Services using itty-aws:
- Lambda, DynamoDB, S3, SQS, EC2, IAM, STS

---

## 2. Cloudflare SDK vs Ad-Hoc Fetch Usage

### Primary Approach: Official SDK (v5.2.0)

The `CloudflareApi` service at `src/cloudflare/api.ts` wraps the official SDK:

```typescript
import { Cloudflare } from "cloudflare";

export class CloudflareApi extends Effect.Service<CloudflareApi>()(
  "cloudflare/api",
  {
    effect: Effect.fn(function* () {
      return createRecursiveProxy(new Cloudflare({ apiToken }));
    }),
  },
) {}
```

**Resources using SDK:**
| Resource | File | SDK Methods |
|----------|------|-------------|
| KV Namespace | `kv/namespace.provider.ts` | `api.kv.namespaces.*` |
| R2 Bucket | `r2/bucket.provider.ts` | `api.r2.buckets.*` |
| D1 Database | `d1/database.provider.ts` | `api.d1.database.*` |
| Queues | `queue/queue.provider.ts` | `api.queues.*` |
| Workers | `worker/worker.provider.ts` | `api.workers.*` |

### Escape Hatch: Raw Fetch

When the SDK has bugs, alchemy-effect uses raw `fetch()`:

**Example: Secrets Store** (`secrets-store/store.provider.ts:49-84`)

```typescript
// WORKAROUND: Cloudflare SDK expects array body but API rejects it.
// TODO: Remove this workaround when Cloudflare fixes SDK/API mismatch
const response = yield* Effect.tryPromise({
  try: async () => {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/secrets_store/stores`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: storeName }),
      },
    );
    // ...
  },
});
```

---

## 3. Contribution Guidelines

### Recommended Approach for New Resources

Based on Pear's guidance and codebase patterns:

```
┌──────────────────────────────────────────────────────┐
│  Decision: How to implement a new Cloudflare resource │
└─────────────────────────┬────────────────────────────┘
                          │
                          ▼
                ┌───────────────────┐
                │ Does SDK support  │
                │ the API correctly?│
                └─────────┬─────────┘
                          │
           ┌──────────────┴──────────────┐
           │                             │
           ▼                             ▼
       ┌───┴───┐                    ┌────┴────┐
       │  YES  │                    │   NO    │
       └───┬───┘                    └────┬────┘
           │                             │
           ▼                             ▼
    Use CloudflareApi              Use raw fetch()
    wrapper pattern               with documentation
```

### Pattern 1: SDK-Based (Preferred)

```typescript
import { CloudflareApi } from "../api.ts";
import { Account } from "../account.ts";

const create = Effect.fn(function* (payload) {
  const api = yield* CloudflareApi;
  const accountId = yield* Account;

  const result = yield* api.some.resource.create({
    account_id: accountId,
    ...payload,
  });

  return result;
});
```

### Pattern 2: Fetch Workaround (When SDK is broken)

```typescript
import { Config } from "../config.ts";
import { Account } from "../account.ts";

const create = Effect.fn(function* (payload) {
  const apiToken = yield* Config.apiToken;
  const accountId = yield* Account;

  // WORKAROUND: [describe the SDK bug]
  // See: [link to Cloudflare docs or issue]
  // TODO: Remove when upstream fixes land
  const response = yield* Effect.tryPromise({
    try: async () => {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/your/endpoint`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Redacted.value(apiToken)}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(`Failed: ${await res.text()}`);
      return (await res.json()).result;
    },
    catch: (error) => new YourResourceError(String(error)),
  });

  return response;
});
```

### Key Requirements

1. **Effect patterns:** All async operations must return `Effect<A, E, R>`
2. **Dependency injection:** Use `Context.Tag` for dependencies
3. **Error types:** Create discriminated union error types per resource
4. **Provider lifecycle:** Implement `create`, `read`, `diff`, `update`, `delete`
5. **Documentation:** Comment any SDK workarounds with TODO for removal

---

## 4. Summary

| Question | Answer |
|----------|--------|
| Is itty ready for Cloudflare? | No - focus is on itty-aws v2 first |
| When will itty-cloudflare exist? | After itty-aws v2 ships |
| What to use now? | Official SDK via `CloudflareApi` wrapper |
| What if SDK has bugs? | Raw `fetch()` with documented workaround |
| Contributing preference? | SDK-first, fetch as escape hatch |

Per Pear:
> "use fetch/cf's sdk until we have our own then move to that"

This is the pragmatic path: implement resources now with SDK/fetch hybrid, migrate to generated SDK later.
