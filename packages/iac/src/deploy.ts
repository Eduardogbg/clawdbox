/**
 * Deploy the Clawdbox infrastructure stack
 *
 * Usage:
 *   bun run src/deploy.ts [--destroy]
 */
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import { LogLevel, pipe } from "effect";
import { config } from "dotenv";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { apply, destroy, make as makeApp, State, dotAlchemy } from "alchemy-effect";
import * as Cloudflare from "alchemy-effect/cloudflare";
import * as Context from "effect/Context";

// CLI Service interface (matches alchemy-effect's CLI)
interface CLIService {
  approvePlan: <P>(plan: P) => Effect.Effect<boolean>;
  displayPlan: <P>(plan: P) => Effect.Effect<void>;
  startApplySession: <P>(plan: P) => Effect.Effect<{
    done: () => Effect.Effect<void>;
    emit: (event: unknown) => Effect.Effect<void>;
  }>;
}

class CLI extends Context.Tag("CLIService")<CLI, CLIService>() {}

// Simple CLI implementation that auto-approves and logs progress
const simpleCLI = Layer.succeed(
  CLI,
  CLI.of({
    approvePlan: () => Effect.succeed(true),
    displayPlan: () => Effect.void,
    startApplySession: () =>
      Effect.succeed({
        done: () => Effect.void,
        emit: (event: unknown) => {
          const e = event as { kind?: string; status?: string; id?: string; type?: string; message?: string };
          return Effect.logInfo(
            e.kind === "status-change"
              ? `${e.status} ${e.id}(${e.type})`
              : `${e.id}: ${e.message}`,
          );
        },
      }),
  }),
);

// Load environment variables
config({ path: ".env" });

// Polyfill File constructor for Node.js if not available
if (typeof globalThis.File === "undefined") {
  const { File } = require("node:buffer");
  globalThis.File = File;
}

// =============================================================================
// Resource Definitions
// =============================================================================

// Secrets Store - API keys and tokens
class Secrets extends Cloudflare.SecretsStore.Store("Secrets", {
  name: "clawdbox-secrets",
  secrets: {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "placeholder",
    TAKOPI_BOT_TOKEN: process.env.TAKOPI_BOT_TOKEN ?? "placeholder",
    TAKOPI_CHAT_ID: process.env.TAKOPI_CHAT_ID ?? "0",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "placeholder",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "placeholder",
    GITHUB_PAT: process.env.GITHUB_PAT ?? "placeholder",
  },
}) {}

// KV Namespace - Caching
class Cache extends Cloudflare.KV.Namespace("Cache", {
  title: "clawdbox-cache",
}) {}

// D1 Database - Analytics
class Analytics extends Cloudflare.D1.Database("Analytics", {
  name: "clawdbox-analytics",
}) {}

// =============================================================================
// Deployment Script
// =============================================================================

const getAccountId = (): string => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID environment variable is required");
  }
  return accountId;
};

const createContext = () => {
  const app = makeApp({
    name: "clawdbox",
    stage: "prod",
    config: {
      adopt: true,
      cloudflare: {
        account: getAccountId(),
      },
    },
  });

  const state = Layer.succeed(State.State, State.inMemoryService({}));
  const platform = Layer.mergeAll(NodeContext.layer, FetchHttpClient.layer);
  const alchemy = Layer.provideMerge(
    Layer.mergeAll(state, dotAlchemy, simpleCLI),
    app,
  );

  return Layer.provideMerge(alchemy, platform);
};

const deployStack = Effect.gen(function* () {
  yield* Effect.logInfo("=== Deploying Clawdbox Infrastructure ===");

  // Apply all resources
  yield* Effect.logInfo("Creating/updating resources...");
  const result = yield* apply(Secrets, Cache, Analytics);

  yield* Effect.logInfo("Secrets Store ID: " + result.Secrets.storeId);
  yield* Effect.logInfo("KV Namespace ID: " + result.Cache.namespaceId);
  yield* Effect.logInfo("D1 Database ID: " + result.Analytics.databaseId);

  yield* Effect.logInfo("=== Deployment Complete ===");
  return result;
});

const destroyStack = Effect.gen(function* () {
  yield* Effect.logInfo("=== Destroying Clawdbox Infrastructure ===");
  yield* destroy();
  yield* Effect.logInfo("=== Destruction Complete ===");
});

const runDeploy = pipe(
  deployStack,
  Effect.provide(Cloudflare.providers()),
  Effect.provide(createContext()),
  Logger.withMinimumLogLevel(LogLevel.Info),
);

const runDestroy = pipe(
  destroyStack,
  Effect.provide(Cloudflare.providers()),
  Effect.provide(createContext()),
  Logger.withMinimumLogLevel(LogLevel.Info),
);

const main = process.argv.includes("--destroy") ? runDestroy : runDeploy;

Effect.runPromise(main)
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
