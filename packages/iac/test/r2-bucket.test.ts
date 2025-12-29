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

class BucketStillExists extends Data.TaggedError("BucketStillExists") {}

const waitForBucketToBeDeleted = Effect.fn(function* (
  bucketName: string,
  accountId: string,
) {
  const api = yield* Cloudflare.CloudflareApi;
  yield* api.r2.buckets
    .get(bucketName, {
      account_id: accountId,
    })
    .pipe(
      Effect.flatMap(() => Effect.fail(new BucketStillExists())),
      Effect.retry({
        while: (e): e is BucketStillExists => e instanceof BucketStillExists,
        schedule: Schedule.exponential(100),
      }),
      Effect.catchTag("NotFound", () => Effect.void),
    );
});

describe("R2 Bucket Integration", () => {
  it.effect(
    "creates, verifies, and deletes R2 bucket",
    () =>
      Effect.gen(function* () {
        const api = yield* Cloudflare.CloudflareApi;
        const accountId = yield* Cloudflare.Account;

        // Clean up any previous test state
        yield* destroy();

        const bucketName = testName("r2-bucket");

        // Create a test bucket using the class-based resource pattern
        class TestBucket extends Cloudflare.R2.Bucket("TestBucket", {
          name: bucketName,
          storageClass: "Standard",
        }) {}

        // Apply the resource
        const stack = yield* apply(TestBucket);

        // Verify the bucket was created
        expect(stack.TestBucket.bucketName).toBeDefined();

        const actualBucket = yield* api.r2.buckets.get(
          stack.TestBucket.bucketName,
          {
            account_id: accountId,
          },
        );
        expect(actualBucket.name).toEqual(stack.TestBucket.bucketName);
        expect(actualBucket.storage_class).toEqual("Standard");

        // Clean up
        yield* destroy();

        // Verify bucket is deleted
        yield* waitForBucketToBeDeleted(stack.TestBucket.bucketName, accountId);
      }).pipe(
        Effect.provide(Cloudflare.providers()),
        Effect.provide(createTestContext("r2-bucket-test")),
        logLevel,
      ),
    { timeout: 120000 },
  );
});

// Placeholder test to verify infrastructure is working
describe("R2 Test Infrastructure", () => {
  it("should have environment variables configured", () => {
    expect(process.env.CLOUDFLARE_API_TOKEN).toBeDefined();
    expect(process.env.CLOUDFLARE_ACCOUNT_ID).toBeDefined();
  });
});
