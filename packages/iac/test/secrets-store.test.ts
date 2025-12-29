import { describe, it, expect } from "bun:test";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
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

class StoreStillExists extends Data.TaggedError("StoreStillExists") {}

// Helper to wait for store deletion
const waitForStoreToBeDeleted = Effect.fn(function* (
  storeName: string,
  accountId: string,
) {
  const api = yield* Cloudflare.CloudflareApi;
  // The secrets store API uses stores directly
  yield* api.secretsStore.stores
    .list({ account_id: accountId })
    .pipe(
      Effect.flatMap((stores) => {
        const exists = stores.result?.some(
          (s: { name?: string }) => s.name === storeName,
        );
        if (exists) {
          return Effect.fail(new StoreStillExists());
        }
        return Effect.void;
      }),
      Effect.retry({
        while: (e): e is StoreStillExists => e instanceof StoreStillExists,
        schedule: Schedule.exponential(100),
      }),
    );
});

describe("SecretsStore Integration", () => {
  it(
    "creates store with secrets, verifies, and deletes",
    async () => {
      const program = pipe(
        Effect.gen(function* () {
          const api = yield* Cloudflare.CloudflareApi;
          const accountId = yield* Cloudflare.Account;

          // Clean up any previous test state
          yield* destroy();

          const storeName = testName("secrets-store");

          // Create a test secrets store
          class TestStore extends Cloudflare.SecretsStore.Store("TestStore", {
            name: storeName,
            secrets: {
              TEST_SECRET_1: "value1",
              TEST_SECRET_2: "value2",
            },
          }) {}

          // Apply the resource
          const stack = yield* apply(TestStore);

          // Verify the store was created
          expect(stack.TestStore.storeId).toBeDefined();
          expect(stack.TestStore.storeName).toEqual(storeName);

          // Verify secrets exist (we can't read the values, only check they exist)
          const stores = yield* api.secretsStore.stores.list({
            account_id: accountId,
          });

          const ourStore = stores.result?.find(
            (s: { name?: string }) => s.name === storeName,
          );
          expect(ourStore).toBeDefined();

          // Clean up
          yield* destroy();

          // Verify store is deleted
          yield* waitForStoreToBeDeleted(storeName, accountId);
        }),
        Effect.ensuring(destroy()),
        Effect.provide(Cloudflare.providers()),
        Effect.provide(createTestContext("secrets-store-test")),
        logLevel,
      );

      await Effect.runPromise(program);
    },
    { timeout: 120000 },
  );
});

// Placeholder test to verify infrastructure is working
describe("SecretsStore Test Infrastructure", () => {
  it("should have environment variables configured", () => {
    expect(process.env.CLOUDFLARE_API_TOKEN).toBeDefined();
    expect(process.env.CLOUDFLARE_ACCOUNT_ID).toBeDefined();
  });
});
