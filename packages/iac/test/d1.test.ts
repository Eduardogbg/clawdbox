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

class DatabaseStillExists extends Data.TaggedError("DatabaseStillExists") {}

// Helper to wait for database deletion
const waitForDatabaseToBeDeleted = Effect.fn(function* (
  databaseId: string,
  accountId: string,
) {
  const api = yield* Cloudflare.CloudflareApi;
  yield* api.d1.database
    .get(databaseId, { account_id: accountId })
    .pipe(
      Effect.flatMap(() => Effect.fail(new DatabaseStillExists())),
      Effect.retry({
        while: (e): e is DatabaseStillExists => e instanceof DatabaseStillExists,
        schedule: Schedule.exponential(100),
      }),
      Effect.catchTag("NotFound", () => Effect.void),
    );
});

describe("D1 Database Integration", () => {
  it.effect(
    "creates database, verifies, and deletes",
    () =>
      Effect.gen(function* () {
        const api = yield* Cloudflare.CloudflareApi;
        const accountId = yield* Cloudflare.Account;

        // Clean up any previous test state
        yield* destroy();

        const dbName = testName("d1-db");

        // Create a test D1 database
        class TestDatabase extends Cloudflare.D1.Database("TestDatabase", {
          name: dbName,
        }) {}

        // Apply the resource
        const stack = yield* apply(TestDatabase);

        // Verify the database was created
        expect(stack.TestDatabase.databaseId).toBeDefined();
        expect(stack.TestDatabase.databaseName).toEqual(dbName);

        // Verify via API
        const actualDb = yield* api.d1.database.get(
          stack.TestDatabase.databaseId,
          { account_id: accountId },
        );
        expect(actualDb.name).toEqual(dbName);

        // Clean up
        yield* destroy();

        // Verify database is deleted
        yield* waitForDatabaseToBeDeleted(stack.TestDatabase.databaseId, accountId);
      }).pipe(
        Effect.provide(Cloudflare.providers()),
        Effect.provide(createTestContext("d1-test")),
        logLevel,
      ),
    { timeout: 120000 },
  );
});

// Placeholder test to verify infrastructure is working
describe("D1 Test Infrastructure", () => {
  it("should have environment variables configured", () => {
    expect(process.env.CLOUDFLARE_API_TOKEN).toBeDefined();
    expect(process.env.CLOUDFLARE_ACCOUNT_ID).toBeDefined();
  });
});
