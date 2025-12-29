import { config } from "dotenv";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { make as makeApp, State, DotAlchemy, dotAlchemy } from "alchemy-effect";

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

// Create a test context with in-memory state
export function createTestContext(name: string) {
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
    Layer.mergeAll(state, dotAlchemy),
    app,
  );

  return Layer.provideMerge(alchemy, platform);
}
