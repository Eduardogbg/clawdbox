import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Data from "effect/Data";
import * as Schedule from "effect/Schedule";
import * as Cloudflare from "alchemy-effect/cloudflare";
import { apply, destroy } from "alchemy-effect";
import { LogLevel } from "effect";
import { testName, createTestContext } from "./setup.ts";

const logLevel = Logger.withMinimumLogLevel(
  process.env.DEBUG ? LogLevel.Debug : LogLevel.Info,
);

class NamespaceStillExists extends Data.TaggedError("NamespaceStillExists") {}

// Helper to wait for namespace deletion
const waitForNamespaceToBeDeleted = Effect.fn(function* (
  namespaceId: string,
  accountId: string,
) {
  const api = yield* Cloudflare.CloudflareApi;
  yield* api.kv.namespaces
    .get(namespaceId, { account_id: accountId })
    .pipe(
      Effect.flatMap(() => Effect.fail(new NamespaceStillExists())),
      Effect.retry({
        while: (e): e is NamespaceStillExists => e instanceof NamespaceStillExists,
        schedule: Schedule.exponential(100),
      }),
      Effect.catchTag("NotFound", () => Effect.void),
    );
});

describe("KV Namespace Integration", () => {
  it.effect(
    "creates namespace, verifies, and deletes",
    () =>
      Effect.gen(function* () {
        const api = yield* Cloudflare.CloudflareApi;
        const accountId = yield* Cloudflare.Account;

        // Clean up any previous test state
        yield* destroy();

        const namespaceName = testName("kv-ns");

        // Create a test KV namespace
        class TestNamespace extends Cloudflare.KV.Namespace("TestNamespace", {
          title: namespaceName,
        }) {}

        // Apply the resource
        const stack = yield* apply(TestNamespace);

        // Verify the namespace was created
        expect(stack.TestNamespace.namespaceId).toBeDefined();
        expect(stack.TestNamespace.title).toEqual(namespaceName);

        // Verify via API
        const actualNs = yield* api.kv.namespaces.get(
          stack.TestNamespace.namespaceId,
          { account_id: accountId },
        );
        expect(actualNs.title).toEqual(namespaceName);

        // Clean up
        yield* destroy();

        // Verify namespace is deleted
        yield* waitForNamespaceToBeDeleted(stack.TestNamespace.namespaceId, accountId);
      }).pipe(
        Effect.provide(Cloudflare.providers()),
        Effect.provide(createTestContext("kv-test")),
        logLevel,
      ),
    { timeout: 120000 },
  );
});

// Placeholder test to verify infrastructure is working
describe("KV Test Infrastructure", () => {
  it("should have environment variables configured", () => {
    expect(process.env.CLOUDFLARE_API_TOKEN).toBeDefined();
    expect(process.env.CLOUDFLARE_ACCOUNT_ID).toBeDefined();
  });
});
