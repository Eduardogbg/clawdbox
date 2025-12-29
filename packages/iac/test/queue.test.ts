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

class QueueStillExists extends Data.TaggedError("QueueStillExists") {}

// Check if Queues are available (requires Workers Paid plan)
// Queues are on a paid plan - skip this test unless CLOUDFLARE_QUEUES_ENABLED is set
const queuesEnabled = process.env.CLOUDFLARE_QUEUES_ENABLED === "true";

// Helper to wait for queue deletion
const waitForQueueToBeDeleted = Effect.fn(function* (
  queueId: string,
  accountId: string,
) {
  const api = yield* Cloudflare.CloudflareApi;
  yield* api.queues
    .get(queueId, { account_id: accountId })
    .pipe(
      Effect.flatMap(() => Effect.fail(new QueueStillExists())),
      Effect.retry({
        while: (e): e is QueueStillExists => e instanceof QueueStillExists,
        schedule: Schedule.exponential(100),
      }),
      // When queue is deleted, we get NotFound - that's success
      Effect.orElse(() => Effect.void),
    );
});

describe("Queue Integration", () => {
  it.effect.skipIf(!queuesEnabled)(
    "creates queue, verifies, and deletes",
    () =>
      Effect.gen(function* () {
        const api = yield* Cloudflare.CloudflareApi;
        const accountId = yield* Cloudflare.Account;

        // Clean up any previous test state
        yield* destroy();

        const queueName = testName("queue");

        // Create a test Queue
        class TestQueue extends Cloudflare.Queue.Queue("TestQueue", {
          name: queueName,
        }) {}

        // Apply the resource
        const stack = yield* apply(TestQueue);

        // Verify the queue was created
        expect(stack.TestQueue.queueId).toBeDefined();
        expect(stack.TestQueue.queueName).toEqual(queueName);

        // Verify via API
        const queues = yield* api.queues.list({
          account_id: accountId,
        });

        const ourQueue = (queues.result ?? []).find(
          (q: { queue_name?: string }) => q.queue_name === queueName,
        );
        expect(ourQueue).toBeDefined();

        // Clean up
        yield* destroy();

        // Verify queue is deleted
        yield* waitForQueueToBeDeleted(stack.TestQueue.queueId, accountId);
      }).pipe(
        Effect.provide(Cloudflare.providers()),
        Effect.provide(createTestContext("queue-test")),
        logLevel,
      ),
    { timeout: 120000 },
  );
});

// Placeholder test to verify infrastructure is working
describe("Queue Test Infrastructure", () => {
  it("should have environment variables configured", () => {
    expect(process.env.CLOUDFLARE_API_TOKEN).toBeDefined();
    expect(process.env.CLOUDFLARE_ACCOUNT_ID).toBeDefined();
  });
});
