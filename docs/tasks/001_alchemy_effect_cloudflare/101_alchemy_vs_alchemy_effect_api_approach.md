# Alchemy vs Alchemy-Effect: Cloudflare API Schema Handling

## Question

How do `alchemy` and `alchemy-effect` deal with the Cloudflare API schema problem? Do they depend on the SDK, the OpenAPI schema, or build their own interface and types - considering the official source is often wrong?

## Findings

### alchemy (original library)

**Does NOT use the official Cloudflare SDK.**

- Custom `CloudflareApi` class at `alchemy/src/cloudflare/api.ts`
- Uses raw `fetch()` calls with custom HTTP method wrappers
- Defines **all types manually** for every Cloudflare resource
- Implements exponential backoff retry logic (max 10 attempts)
- Custom authentication with profile-based credential discovery

```typescript
// alchemy approach - direct fetch
export class CloudflareApi {
  async post(path: string, body: any, init?: RequestInit): Promise<Response> {
    return this.fetch(path, {
      method: "POST",
      body: JSON.stringify(body),
      ...init,
    });
  }
}

// usage in providers
const response = await api.post(`/accounts/${api.accountId}/tokens`, requestBody);
```

**Custom type definitions example** (`zone-settings.ts`):
```typescript
export type SSLValue = "off" | "flexible" | "full" | "strict";
export type MinTLSVersionValue = "1.0" | "1.1" | "1.2" | "1.3";

export interface AlwaysUseHTTPSSetting extends CloudflareSettingBase {
  id: "always_use_https";
  value: AlwaysUseHTTPSValue;
}
```

---

### alchemy-effect

**Uses the official `cloudflare` SDK** (`^5.2.0`).

- Wraps SDK with Effect's functional error handling
- Imports types from `"cloudflare/resources"`
- Creates a recursive proxy around SDK client to convert promises to Effects
- Custom `CloudflareApiError` discriminated union for typed error handling

```typescript
// alchemy-effect approach - SDK wrapped with Effect
export class CloudflareApi extends Effect.Service<CloudflareApi>()(
  "cloudflare/api",
  {
    effect: Effect.fn(function* () {
      return createRecursiveProxy(
        new Cloudflare({ apiToken, ... }),
      );
    }),
  },
) {}

// usage in providers
const api = yield* CloudflareApi;
const database = yield* api.d1.database.create({
  account_id: accountId,
  name: payload.name,
});
```

---

## Implications for SDK/Schema Bugs

When the Cloudflare OpenAPI spec is wrong (e.g., Secrets Store `POST` expecting array but API only accepting object):

| Library | Impact | Resolution |
|---------|--------|------------|
| **alchemy** | Unaffected | Just construct correct JSON manually |
| **alchemy-effect** | Broken | Must patch SDK or use fetch workaround |

### Current alchemy-effect workaround

In `store.provider.ts`, bypasses the SDK for Secrets Store creation:

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

---

## Tradeoff Analysis

| Aspect | alchemy (custom) | alchemy-effect (SDK) |
|--------|------------------|----------------------|
| **Type safety** | Manual maintenance | Auto from SDK |
| **SDK bug immunity** | Yes | No - needs workarounds |
| **Maintenance burden** | Higher (maintain all types) | Lower (SDK updates) |
| **Flexibility** | Full control | Constrained by SDK |
| **Dependencies** | Lighter | Heavier (SDK + deps) |

---

## Recommendation

For `alchemy-effect`, the pragmatic approach is:

1. **Use SDK by default** - benefit from type safety and auto-updates
2. **Bypass with fetch when SDK is broken** - as done for Secrets Store
3. **Maintain local SDK patches** in `forks/` for critical bugs
4. **Document workarounds** so they can be removed when upstream fixes land

This hybrid approach gets the best of both worlds: SDK type safety where it works, and escape hatches where it doesn't.

---

## Files Referenced

- `alchemy/src/cloudflare/api.ts` - Custom CloudflareApi class
- `alchemy/src/cloudflare/zone-settings.ts` - Custom type definitions
- `alchemy-effect/src/cloudflare/api.ts` - SDK wrapper with Effect
- `alchemy-effect/src/cloudflare/secrets-store/store.provider.ts` - Fetch workaround
- `forks/cloudflare-typescript/` - Patched SDK
- `forks/api-schemas/` - Patched OpenAPI schemas
