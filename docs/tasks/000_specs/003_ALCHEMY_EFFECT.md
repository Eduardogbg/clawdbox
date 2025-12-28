# Alchemy-Effect IaC Strategy

> Infrastructure-as-Effects for clawdbox using alchemy-effect

## Overview

Clawdbox uses [alchemy-effect](https://github.com/alchemy-run/alchemy-effect) for infrastructure management. This is an experimental IaC framework built on Effect.ts that provides:

1. **Type-Checked IAM Policies** - Compile-time validation of permissions
2. **Optimally Tree-Shaken Bundles** - Only deploy what you use
3. **Testable Business Logic** - Effect-based architecture
4. **Reviewable Deployment Plans** - Audit changes before applying

## Current State

alchemy-effect currently supports limited Cloudflare resources:
- KV Namespace
- R2 Bucket
- Worker

**Missing resources we need:**
- Container / ContainerApplication
- DurableObjectNamespace
- SecretsStore
- Queue (optional)

## Upstream Contribution Strategy

We will contribute missing resources to alchemy-effect. Reference implementations exist in the original [alchemy](https://github.com/alchemy-run/alchemy) repo.

### Resource Implementation Pattern

Each resource in alchemy-effect follows this pattern:

```typescript
// 1. Define the resource class
class MyResource extends Resource("MyResource", {
  // Schema for properties
  schema: S.Struct({
    name: S.String,
    // ...
  }),
}) {}

// 2. Implement the provider (create/update/delete)
class MyResourceProvider extends Provider("MyResource", {
  create: Effect.fn(function* (props) {
    // API calls to create resource
    return { id: "...", ...output };
  }),
  update: Effect.fn(function* (props, current) {
    // API calls to update resource
    return { id: "...", ...output };
  }),
  delete: Effect.fn(function* (current) {
    // API calls to delete resource
  }),
}) {}

// 3. Define bindings/capabilities if applicable
const MyResourceBinding = Binding("MyResource", {
  // Define what operations are available
});
```

### Resources to Contribute

#### 1. Container Resource

Reference: `alchemy/alchemy/src/cloudflare/container.ts`

```typescript
import { Effect, Schema as S } from "effect";

// Container binding (for Worker bindings)
class Container extends Binding("cloudflare::Container", {
  schema: S.Struct({
    className: S.String,
    maxInstances: S.optional(S.Number),
    instanceType: S.optional(S.Literal("lite", "basic", "standard-1", "standard-2")),
    sqlite: S.optional(S.Boolean),
  }),
}) {}

// ContainerApplication resource (managed deployment)
class ContainerApplication extends Resource("cloudflare::ContainerApplication", {
  schema: S.Struct({
    name: S.optional(S.String),
    image: Image, // Reference to Docker image
    instances: S.optional(S.Number),
    maxInstances: S.optional(S.Number),
    instanceType: S.optional(S.String),
    schedulingPolicy: S.optional(S.String),
    durableObjects: S.optional(S.Struct({
      namespaceId: S.String,
    })),
  }),
}) {}
```

#### 2. DurableObjectNamespace Resource

Reference: `alchemy/alchemy/src/cloudflare/durable-object-namespace.ts`

```typescript
class DurableObjectNamespace extends Binding("cloudflare::DurableObjectNamespace", {
  schema: S.Struct({
    className: S.String,
    scriptName: S.optional(S.String),
    environment: S.optional(S.String),
    sqlite: S.optional(S.Boolean),
  }),
}) {}
```

#### 3. SecretsStore Resource

Reference: `alchemy/alchemy/src/cloudflare/secrets-store.ts`

```typescript
class SecretsStore extends Resource("cloudflare::SecretsStore", {
  schema: S.Struct({
    name: S.optional(S.String),
    secrets: S.optional(S.Record(S.String, Secret)),
    adopt: S.optional(S.Boolean),
  }),
}) {}

// Capabilities
const SecretsStoreGet = Capability("cloudflare::SecretsStore::Get", {
  // ...
});
```

## Project Structure

```
clawdbox/
├── alchemy.run.ts              # Main IaC entrypoint
├── src/
│   ├── infra/
│   │   ├── resources/          # Custom resources (if not upstreamed)
│   │   │   ├── container.ts
│   │   │   ├── durable-object.ts
│   │   │   └── secrets-store.ts
│   │   ├── worker.ts           # Worker definition
│   │   ├── operator.ts         # Operator DO definition
│   │   └── storage.ts          # R2 bucket definition
│   ├── worker/                 # Worker source code
│   └── agent/                  # Agent container code
├── Dockerfile                  # Agent container image
└── secretspec.toml             # Secret declarations
```

## Example: Main IaC File

```typescript
// alchemy.run.ts
import { Effect, pipe } from "effect";
import * as Cloudflare from "alchemy-effect/cloudflare";
import { $ } from "alchemy-effect";

// Secrets Store
class Secrets extends Cloudflare.SecretsStore("Secrets", {
  secrets: {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GITHUB_PAT: process.env.GITHUB_PAT,
  },
}) {}

// R2 Bucket for repo storage
class Storage extends Cloudflare.R2.Bucket("Storage", {}) {}

// Durable Object for Operator
class Operator extends Cloudflare.DurableObjectNamespace("Operator", {
  className: "OperatorDO",
  sqlite: true,
}) {}

// Agent Container
class AgentContainer extends Cloudflare.Container("Agent", {
  className: "AgentContainer",
  maxInstances: 10,
  instanceType: "basic",
  sqlite: true,
}) {}

// Main Worker
class TelegramWorker extends Cloudflare.Worker.serve("TelegramWorker", {
  fetch: Effect.fn(function* (request, env) {
    // Handler implementation
    return new Response("OK");
  }),
})({
  main: import.meta.filename,
  bindings: $(
    Cloudflare.R2.Binding(Storage),
    Cloudflare.DurableObjectBinding(Operator),
    Cloudflare.ContainerBinding(AgentContainer),
    Cloudflare.SecretsStoreBinding(Secrets),
  ),
}) {}

// Export for deployment
export default TelegramWorker;
```

## Effect Patterns

### Dependency Injection

```typescript
// Define service interface
class CloudflareApi extends Context.Tag("CloudflareApi")<
  CloudflareApi,
  {
    readonly accountId: string;
    readonly get: (path: string) => Effect.Effect<Response>;
    readonly post: (path: string, body: unknown) => Effect.Effect<Response>;
  }
>() {}

// Live implementation
const CloudflareApiLive = Layer.succeed(
  CloudflareApi,
  CloudflareApi.of({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    get: (path) =>
      Effect.tryPromise(() =>
        fetch(`https://api.cloudflare.com/client/v4${path}`, {
          headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
        })
      ),
    // ...
  })
);
```

### Resource Acquisition

```typescript
// Safe resource management with Effect
const withContainer = Effect.acquireUseRelease(
  // Acquire: spawn container
  Effect.gen(function* () {
    const container = yield* spawnContainer(taskId);
    return container;
  }),
  // Use: execute agent work
  (container) =>
    Effect.gen(function* () {
      yield* runAgent(container, prompt);
    }),
  // Release: cleanup container
  (container) =>
    Effect.gen(function* () {
      yield* terminateContainer(container.id);
    })
);
```

### Error Handling

```typescript
// Typed errors
class ContainerSpawnError extends Data.TaggedError("ContainerSpawnError")<{
  readonly reason: string;
}> {}

class PermissionDeniedError extends Data.TaggedError("PermissionDeniedError")<{
  readonly tool: string;
}> {}

// Usage
const spawnAgent = Effect.gen(function* () {
  const container = yield* spawnContainer(taskId).pipe(
    Effect.catchTag("ContainerSpawnError", (e) =>
      Effect.logError(`Failed to spawn: ${e.reason}`).pipe(
        Effect.flatMap(() => Effect.fail(e))
      )
    )
  );
  return container;
});
```

## Local Development

alchemy-effect supports local development with Miniflare:

```typescript
// In alchemy.run.ts
import { Scope } from "alchemy-effect";

// Development mode
if (process.env.NODE_ENV === "development") {
  Scope.current.local = true;
}
```

This enables:
- Local Worker execution
- Local Durable Object simulation
- Local KV/R2 storage
- Container dev mode (builds locally, doesn't push to registry)

## Deployment Commands

```bash
# Plan changes
bun run alchemy.run.ts --plan

# Apply changes
bun run alchemy.run.ts --apply

# Destroy resources
bun run alchemy.run.ts --destroy
```

## Testing

```typescript
// Test infrastructure with Effect test utilities
import { it, expect } from "@effect/vitest";

it.effect("creates container", () =>
  Effect.gen(function* () {
    const container = yield* Container("test", {
      className: "TestContainer",
      maxInstances: 1,
    });

    expect(container.className).toBe("TestContainer");
  }).pipe(
    Effect.provide(TestCloudflareApiLayer)
  )
);
```

## Migration Path

1. **Phase 1**: Fork alchemy-effect, add missing resources locally
2. **Phase 2**: Test resources in clawdbox
3. **Phase 3**: Submit PR upstream to alchemy-effect
4. **Phase 4**: Switch to published package once merged
