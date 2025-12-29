import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Data from "effect/Data";
import * as Schedule from "effect/Schedule";
import * as Cloudflare from "alchemy-effect/cloudflare";
import { $, apply, destroy } from "alchemy-effect";
import { LogLevel } from "effect";
import { testName, createTestContext } from "./setup.ts";
import * as pathe from "pathe";

const logLevel = Logger.withMinimumLogLevel(
  process.env.DEBUG ? LogLevel.Debug : LogLevel.Info,
);

class WorkerStillExists extends Data.TaggedError("WorkerStillExists") {}

// The main entrypoint file for the worker
// This is required by the Worker.serve API
const main = pathe.resolve(import.meta.dirname, "fixtures/test-worker.ts");

// Helper to wait for worker deletion
const waitForWorkerToBeDeleted = Effect.fn(function* (
  workerId: string,
  accountId: string,
) {
  const api = yield* Cloudflare.CloudflareApi;
  yield* api.workers.scripts
    .get(workerId, {
      account_id: accountId,
    })
    .pipe(
      Effect.flatMap(() => Effect.fail(new WorkerStillExists())),
      Effect.retry({
        while: (e): e is WorkerStillExists => e instanceof WorkerStillExists,
        schedule: Schedule.exponential(100),
      }),
      Effect.catchTag("NotFound", () => Effect.void),
    );
});

describe("Worker Integration", () => {
  it.effect(
    "creates, verifies, and deletes Worker",
    () =>
      Effect.gen(function* () {
        const api = yield* Cloudflare.CloudflareApi;
        const accountId = yield* Cloudflare.Account;

        // Clean up any previous test state
        yield* destroy();

        const workerName = testName("worker");

        // Create a test worker using the Worker.serve API
        class TestWorker extends Cloudflare.Worker.serve("TestWorker", {
          fetch: Effect.fn(function* (request) {
            return new Response("Hello from TestWorker");
          }),
        })({
          name: workerName,
          main,
          bindings: $(),
          subdomain: { enabled: false },
          compatibility: {
            date: "2024-01-01",
          },
        }) {}

        // Apply the resource
        const stack = yield* apply(TestWorker);

        // Verify the worker was created
        expect(stack.TestWorker.workerName).toEqual(workerName);
        expect(stack.TestWorker.workerId).toBeDefined();

        // Verify via API
        const actualWorker = yield* api.workers.beta.workers.get(
          stack.TestWorker.workerName,
          {
            account_id: accountId,
          },
        );
        expect(actualWorker.name).toEqual(stack.TestWorker.workerName);

        // Clean up
        yield* destroy();

        // Verify worker is deleted
        yield* waitForWorkerToBeDeleted(stack.TestWorker.workerId, accountId);
      }).pipe(
        Effect.provide(Cloudflare.providers()),
        Effect.provide(createTestContext("worker-test")),
        logLevel,
      ),
    { timeout: 180000 },
  );
});

// Placeholder test to verify infrastructure is working
describe("Worker Test Infrastructure", () => {
  it("should have environment variables configured", () => {
    expect(process.env.CLOUDFLARE_API_TOKEN).toBeDefined();
    expect(process.env.CLOUDFLARE_ACCOUNT_ID).toBeDefined();
  });
});
