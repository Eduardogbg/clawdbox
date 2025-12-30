import { defineStack, defineStages } from "alchemy-effect";
import * as Cloudflare from "alchemy-effect/cloudflare";

// =============================================================================
// Secrets Store
// =============================================================================
// Stores API keys and tokens needed at runtime
const Secrets = Cloudflare.SecretsStore.Store("Secrets", {
  name: "clawdbox-secrets",
  secrets: {
    // Placeholder secrets - replace with actual values or env vars
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "placeholder",
    TAKOPI_BOT_TOKEN: process.env.TAKOPI_BOT_TOKEN ?? "placeholder",
    TAKOPI_CHAT_ID: process.env.TAKOPI_CHAT_ID ?? "0",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "placeholder",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "placeholder",
    GITHUB_PAT: process.env.GITHUB_PAT ?? "placeholder",
  },
});

// =============================================================================
// R2 Storage
// =============================================================================
// Stores git repository snapshots, artifacts, and session data
// NOTE: R2 requires activation in the Cloudflare dashboard before use
const Storage = Cloudflare.R2.Bucket("Storage", {
  name: "clawdbox-storage",
});

// =============================================================================
// KV Namespace
// =============================================================================
// Key-Value store for caching and quick lookups
const Cache = Cloudflare.KV.Namespace("Cache", {
  title: "clawdbox-cache",
});

// =============================================================================
// D1 Database
// =============================================================================
// SQLite database for analytics and metadata
// Note: Primary task/session storage is in Durable Object SQLite,
// D1 is for cross-worker analytics and reporting
const Analytics = Cloudflare.D1.Database("Analytics", {
  name: "clawdbox-analytics",
});

// =============================================================================
// Durable Object Namespace (Binding)
// =============================================================================
// Operator DO for managing agent state and coordination
// Note: This is a binding, not a resource - it's used when defining a Worker
const Operator = Cloudflare.DurableObject.Namespace("Operator", {
  className: "OperatorDO",
  sqlite: true,
});

// =============================================================================
// Stack Definition
// =============================================================================
// Get account ID from environment, or throw at runtime if not set
const getAccountId = (): string => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID environment variable is required. " +
        "Set it to your Cloudflare account ID."
    );
  }
  return accountId;
};

export default defineStack({
  name: "clawdbox",
  stages: defineStages((stage) => ({
    cloudflare: {
      account: getAccountId(),
    },
  })),
  // Note: R2 (Storage) excluded until enabled in CF dashboard
  resources: [Secrets, Cache, Analytics],
  providers: Cloudflare.providers(),
});
