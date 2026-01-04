import { $, declare, defineStack, defineStages } from "alchemy-effect";
import * as Cloudflare from "alchemy-effect/cloudflare";
import * as Effect from "effect/Effect";
import * as path from "node:path";

// =============================================================================
// Secrets Store
// =============================================================================
// Stores API keys and tokens needed at runtime
const Secrets = Cloudflare.SecretsStore.Store("Secrets", {
  name: "clawdbox-secrets",
  secrets: {
    // Placeholder secrets - replace with actual values or env vars
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "placeholder",
    OPENAI_API_KEY:
      process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY ?? "placeholder",
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
// Agent Container + Worker
// =============================================================================
const agentWorkerMain = path.resolve(
  import.meta.dirname,
  "../../agent-worker/src/index.ts",
);

const AgentContainer = Cloudflare.Container.Container("AgentContainer", {
  className: "AgentContainerDO",
});

const Orchestrator = Cloudflare.DurableObject.Namespace("Orchestrator", {
  className: "OrchestratorDO",
  sqlite: true,
});

const requireAgentContainer = declare<
  Cloudflare.Container.Bind<typeof AgentContainer>
>();
const requireOrchestrator = declare<
  Cloudflare.DurableObject.Bind<typeof Orchestrator>
>();

class AgentWorker extends Cloudflare.Worker.serve("AgentWorker", {
  fetch: Effect.fn(function* () {
    yield* requireAgentContainer;
    yield* requireOrchestrator;
    return new Response("ok");
  }),
})({
  name: "clawdbox-agent-worker",
  main: agentWorkerMain,
  vars: {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "placeholder",
    TELEGRAM_SECRET_TOKEN: process.env.TELEGRAM_SECRET_TOKEN ?? "",
    CODEX_API_KEY: process.env.CODEX_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY ?? "",
    CODEX_PROFILE: process.env.CODEX_PROFILE ?? "",
    CODEX_ARGS: process.env.CODEX_ARGS ?? "",
    CONTAINER_WORKDIR: process.env.CONTAINER_WORKDIR ?? "",
    CONTAINER_REPO_URL: process.env.CONTAINER_REPO_URL ?? "",
    CONTAINER_REPO_BRANCH: process.env.CONTAINER_REPO_BRANCH ?? "",
    MAX_QUEUE_SIZE: process.env.MAX_QUEUE_SIZE ?? "",
    PROGRESS_EDIT_MS: process.env.PROGRESS_EDIT_MS ?? "",
    RUN_START_TIMEOUT_MS: process.env.RUN_START_TIMEOUT_MS ?? "",
    RUN_IDLE_TIMEOUT_MS: process.env.RUN_IDLE_TIMEOUT_MS ?? "",
    RUN_MAX_MS: process.env.RUN_MAX_MS ?? "",
  },
  bindings: $(
    Cloudflare.Container.Bind(AgentContainer),
    Cloudflare.DurableObject.Bind(Orchestrator),
  ),
  compatibility: {
    date: "2024-12-01",
    flags: ["nodejs_compat"],
  },
  migrations: {
    new_tag: "v1",
    new_sqlite_classes: ["AgentContainerDO", "OrchestratorDO"],
  },
  subdomain: { enabled: true },
}) {}

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
  resources: [Secrets, Cache, Analytics, AgentWorker],
  providers: Cloudflare.providers(),
});
