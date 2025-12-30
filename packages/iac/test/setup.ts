import { config } from "dotenv";
import { FetchHttpClient } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import type * as HttpClient from "@effect/platform/HttpClient";
import { NodeContext } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  make as makeApp,
  State,
  dotAlchemy,
} from "alchemy-effect";
import type { App, DotAlchemy } from "alchemy-effect";
import { CLI } from "alchemy-effect/cli/service";

config({ path: ".env" });

// Polyfill File constructor for Node.js if not available
if (typeof globalThis.File === "undefined") {
  const { File } = require("node:buffer");
  globalThis.File = File;
}

// Test naming convention: all test resources use "test-" prefix
export const TEST_PREFIX = "test-";

// Generate a unique test resource name
export function testName(base: string): string {
  return `${TEST_PREFIX}${base}-${Date.now()}`;
}

export type TestContext =
  | NodeContext.NodeContext
  | App
  | State.State
  | DotAlchemy
  | CLI
  | HttpClient.HttpClient;

const testCLI = Layer.succeed(
  CLI,
  CLI.of({
    approvePlan: () => Effect.succeed(true),
    displayPlan: () => Effect.void,
    startApplySession: () =>
      Effect.succeed({
        done: () => Effect.void,
        emit: (event) =>
          Effect.log(
            event.kind === "status-change"
              ? `${event.status} ${event.id}(${event.type})`
              : `${event.id}: ${event.message}`,
          ),
      }),
  }),
);

// Create a test context with in-memory state
export function createTestContext(
  name: string,
): Layer.Layer<TestContext, PlatformError> {
  const app = makeApp({
    name: name.replaceAll(/[^a-zA-Z0-9_-]/g, "-"),
    stage: "test",
    config: {
      adopt: true,
      cloudflare: {
        account: process.env.CLOUDFLARE_ACCOUNT_ID!,
      },
    },
  });

  const state = Layer.succeed(State.State, State.inMemoryService({}));

  // Build the full context with all required services
  const platform = Layer.mergeAll(NodeContext.layer, FetchHttpClient.layer);

  const alchemy = Layer.provideMerge(
    Layer.mergeAll(state, dotAlchemy, testCLI),
    app,
  );

  return Layer.provideMerge(alchemy, platform);
}

export function createE2eContext(
  name: string,
  stage: string,
): Layer.Layer<TestContext, PlatformError> {
  const app = makeApp({
    name: name.replaceAll(/[^a-zA-Z0-9_-]/g, "-"),
    stage: stage.replaceAll(/[^a-zA-Z0-9_-]/g, "-"),
    config: {
      adopt: true,
      cloudflare: {
        account: process.env.CLOUDFLARE_ACCOUNT_ID!,
      },
    },
  });

  const state = State.localFs;

  const platform = Layer.mergeAll(NodeContext.layer, FetchHttpClient.layer);

  const alchemy = Layer.provideMerge(
    Layer.mergeAll(state, dotAlchemy, testCLI),
    app,
  );

  return Layer.provideMerge(alchemy, platform);
}
