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
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "placeholder",
    GITHUB_PAT: process.env.GITHUB_PAT ?? "placeholder",
  },
});

// =============================================================================
// R2 Storage
// =============================================================================
// Stores git repository snapshots, artifacts, and session data
const Storage = Cloudflare.R2.Bucket("Storage", {
  name: "clawdbox-storage",
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
export default defineStack({
  name: "clawdbox",
  stages: defineStages((stage) => ({
    cloudflare: {
      account: process.env.CLOUDFLARE_ACCOUNT_ID,
    },
  })),
  resources: [Secrets, Storage],
  providers: Cloudflare.providers(),
});
