/**
 * Deploy a dev environment for the Telegram webhook + Codex container stack.
 *
 * Usage:
 *   bun run src/dev-environment.ts
 *   bun run src/dev-environment.ts --destroy
 */
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import { LogLevel, pipe } from "effect";
import { config } from "dotenv";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import * as Context from "effect/Context";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as S from "effect/Schema";
import {
  apply,
  destroy,
  make as makeApp,
  State,
  dotAlchemy,
} from "alchemy-effect";
import * as Cloudflare from "alchemy-effect/cloudflare";
import { withWranglerConfig } from "./wrangler-config.js";

config({ path: ".env" });

if (typeof globalThis.File === "undefined") {
  const { File } = require("node:buffer");
  globalThis.File = File;
}

interface CLIService {
  approvePlan: <P>(plan: P) => Effect.Effect<boolean>;
  displayPlan: <P>(plan: P) => Effect.Effect<void>;
  startApplySession: <P>(plan: P) => Effect.Effect<{
    done: () => Effect.Effect<void>;
    emit: (event: unknown) => Effect.Effect<void>;
  }>;
}

class CLI extends Context.Tag("CLIService")<CLI, CLIService>() {}

const simpleCLI = Layer.succeed(
  CLI,
  CLI.of({
    approvePlan: () => Effect.succeed(true),
    displayPlan: () => Effect.void,
    startApplySession: () =>
      Effect.succeed({
        done: () => Effect.void,
        emit: (event: unknown) => {
          const e = event as {
            kind?: string;
            status?: string;
            id?: string;
            type?: string;
            message?: string;
          };
          return Effect.logInfo(
            e.kind === "status-change"
              ? `${e.status} ${e.id}(${e.type})`
              : `${e.id}: ${e.message}`,
          );
        },
      }),
  }),
);

const DevEnvSchema = S.Struct({
  CLOUDFLARE_ACCOUNT_ID: S.String,
  CLOUDFLARE_API_TOKEN: S.String,
  CLAWDBOX_DEV_TAG: S.optional(S.String),
  TELEGRAM_BOT_TOKEN: S.String,
  TELEGRAM_SECRET_TOKEN: S.optional(S.String),
  CODEX_API_KEY: S.optional(S.String),
  OPENAI_API_KEY: S.optional(S.String),
  CODEX_PROFILE: S.optional(S.String),
  CODEX_ARGS: S.optional(S.String),
  MANAGER_CLI_TOKEN: S.optional(S.String),
  CONTAINER_WORKDIR: S.optional(S.String),
  CONTAINER_REPO_URL: S.optional(S.String),
  CONTAINER_REPO_BRANCH: S.optional(S.String),
  MAX_QUEUE_SIZE: S.optional(S.String),
  PROGRESS_EDIT_MS: S.optional(S.String),
  RUN_START_TIMEOUT_MS: S.optional(S.String),
  RUN_IDLE_TIMEOUT_MS: S.optional(S.String),
  RUN_MAX_MS: S.optional(S.String),
  AGENT_IMAGE: S.optional(S.String),
  AGENT_IMAGE_REPO: S.optional(S.String),
  AGENT_IMAGE_TAG: S.optional(S.String),
  AGENT_IMAGE_PLATFORM: S.optional(S.String),
  AGENT_REGISTRY_TTL_MINUTES: S.optional(S.NumberFromString),
});

type DevEnv = S.Schema.Type<typeof DevEnvSchema>;

const loadDevEnv = pipe(
  Effect.succeed(process.env),
  Effect.flatMap(S.decodeUnknown(DevEnvSchema)),
  Effect.mapError((error) => new Error(`Invalid env: ${error}`)),
);

const buildTag = (env: DevEnv) =>
  env.CLAWDBOX_DEV_TAG ?? `dev-${Date.now().toString(36)}`;

const defaultImageRepo = "clawdbox-agent";
const defaultImagePlatform = "linux/amd64";
const defaultRegistryTtlMinutes = 60;

const agentWorkerDir = path.resolve(import.meta.dirname, "../../agent-worker");
const agentContainerDir = path.resolve(import.meta.dirname, "../../agent-container");
const agentWorkerWranglerPath = path.join(agentWorkerDir, "wrangler.toml");

const runCommand = (cmd: string[], cwd?: string, env?: Record<string, string>) =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn({
        cmd,
        cwd,
        env,
        stdout: "inherit",
        stderr: "inherit",
      });
      const exit = await proc.exited;
      if (exit !== 0) {
        throw new Error(`${cmd.join(" ")} failed (${exit})`);
      }
    },
    catch: (error) => new Error(`${cmd.join(" ")} failed: ${error}`),
  });

const runWrangler = (args: string[], configPath?: string) => {
  const configArgs = configPath ? ["--config", configPath] : [];
  return runCommand(
    ["npx", "wrangler", ...configArgs, ...args],
    agentWorkerDir,
    {
      ...process.env,
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? "",
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    },
  );
};

const sanitizeImageTag = (tag: string) =>
  tag.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");

const buildImageRef = (accountId: string, env: DevEnv, devTag: string) => {
  const repo = env.AGENT_IMAGE_REPO ?? defaultImageRepo;
  const tag = sanitizeImageTag(env.AGENT_IMAGE_TAG ?? devTag);
  return { repo, tag, ref: `registry.cloudflare.com/${accountId}/${repo}:${tag}` };
};

const RegistryCredentialsResponseSchema = S.Struct({
  success: S.Boolean,
  result: S.optional(
    S.Struct({
      username: S.String,
      password: S.String,
    }),
  ),
  errors: S.optional(
    S.Array(
      S.Struct({
        code: S.Number,
        message: S.String,
      }),
    ),
  ),
});

type RegistryCredentials = {
  username: string;
  password: string;
};

const fetchRegistryCredentials = (
  accountId: string,
  apiToken: string,
  ttlMinutes: number,
) =>
  pipe(
    Effect.tryPromise({
      try: () =>
        fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/containers/registries/registry.cloudflare.com/credentials`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              permissions: ["pull", "push"],
              expiration_minutes: ttlMinutes,
            }),
          },
        ),
      catch: (error) =>
        new Error(`Registry credential request failed: ${error}`),
    }),
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(
            new Error(
              `Registry credential request failed (${response.status})`,
            ),
          ),
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: (error) =>
          new Error(`Invalid registry credential response: ${error}`),
      }),
    ),
    Effect.flatMap(S.decodeUnknown(RegistryCredentialsResponseSchema)),
    Effect.flatMap((payload) => {
      if (payload.success && payload.result) {
        const credentials: RegistryCredentials = {
          username: payload.result.username,
          password: payload.result.password,
        };
        return Effect.succeed(credentials);
      }
      const message =
        payload.errors?.map((error) => error.message).join("; ") ??
        "Unknown registry credential error";
      return Effect.fail(new Error(message));
    }),
    Effect.mapError((error) => new Error(`Registry credential error: ${error}`)),
  );

const withTempDir = <A, E, R>(
  prefix: string,
  use: (dir: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => fs.mkdtemp(path.join(os.tmpdir(), prefix)),
      catch: (error) => new Error(`Failed to create temp dir: ${error}`),
    }),
    use,
    (dir) =>
      pipe(
        Effect.tryPromise({
          try: () => fs.rm(dir, { recursive: true, force: true }),
          catch: (error) => new Error(`Failed to cleanup temp dir: ${error}`),
        }),
        Effect.catchAll((error) =>
          Effect.logWarning(`Temp dir cleanup failed: ${error}`),
        ),
      ),
  );

type BuildImageInput = {
  accountId: string;
  apiToken: string;
  repo: string;
  tag: string;
  platform: string;
  ttlMinutes: number;
};

const buildAndPushAgentImage = (input: BuildImageInput) =>
  withTempDir("clawdbox-agent-", (workDir) =>
    Effect.gen(function* () {
      const imageRef = `registry.cloudflare.com/${input.accountId}/${input.repo}:${input.tag}`;
      const localTag = `${input.repo}:${input.tag}`;
      const tarPath = path.join(workDir, "agent-image.tar");
      const dockerfilePath = path.join(agentContainerDir, "Dockerfile");

      yield* Effect.logInfo(`Building agent image (${localTag})...`);
      yield* runCommand(["docker", "info"]);
      yield* runCommand([
        "docker",
        "build",
        "--platform",
        input.platform,
        "-t",
        localTag,
        "-f",
        dockerfilePath,
        agentContainerDir,
      ]);
      yield* runCommand(["docker", "save", localTag, "-o", tarPath]);

      yield* Effect.logInfo("Fetching registry credentials...");
      const credentials = yield* fetchRegistryCredentials(
        input.accountId,
        input.apiToken,
        input.ttlMinutes,
      );

      return yield* withTempDir("clawdbox-registry-", (configDir) =>
        pipe(
          Effect.logInfo("Preparing registry auth config..."),
          Effect.flatMap(() =>
            Effect.tryPromise({
              try: async () => {
                const auth = Buffer.from(
                  `${credentials.username}:${credentials.password}`,
                ).toString("base64");
                const config = {
                  auths: {
                    "registry.cloudflare.com": {
                      auth,
                    },
                  },
                };
                await fs.writeFile(
                  path.join(configDir, "config.json"),
                  JSON.stringify(config),
                  "utf8",
                );
              },
              catch: (error) =>
                new Error(`Failed to write registry auth config: ${error}`),
            }),
          ),
          Effect.tap(() =>
            Effect.logInfo("Pushing agent image via crane..."),
          ),
          Effect.flatMap(() =>
            runCommand(["crane", "-v", "push", tarPath, imageRef], undefined, {
              ...process.env,
              DOCKER_CONFIG: configDir,
            }),
          ),
          Effect.as(imageRef),
        ),
      );
    }),
  );

const setWebhook = (botToken: string, url: string, secretToken?: string) =>
  pipe(
    Effect.tryPromise({
      try: () =>
        fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            ...(secretToken ? { secret_token: secretToken } : {}),
          }),
        }),
      catch: (error) => new Error(`Webhook request failed: ${error}`),
    }),
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(
            new Error(`Webhook request failed (${response.status})`),
          ),
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: (error) => new Error(`Webhook response JSON failed: ${error}`),
      }),
    ),
    Effect.tap((payload) =>
      Effect.logInfo(`Telegram webhook response: ${JSON.stringify(payload)}`),
    ),
    Effect.asVoid,
  );

const setBotCommands = (
  botToken: string,
  commands: Array<{ command: string; description: string }>,
) =>
  pipe(
    Effect.tryPromise({
      try: () =>
        fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commands }),
        }),
      catch: (error) => new Error(`setMyCommands request failed: ${error}`),
    }),
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(
            new Error(`setMyCommands request failed (${response.status})`),
          ),
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: (error) => new Error(`setMyCommands response JSON failed: ${error}`),
      }),
    ),
    Effect.tap((payload) =>
      Effect.logInfo(`Telegram commands response: ${JSON.stringify(payload)}`),
    ),
    Effect.asVoid,
  );

const devSecretsStoreName = "clawdbox-dev-takopi-secrets";

const makeResources = (resourcePrefix: string, env: DevEnv) => {
  const apiKey = env.CODEX_API_KEY ?? env.OPENAI_API_KEY ?? "placeholder";
  const Secrets = Cloudflare.SecretsStore.Store("DevSecrets", {
    name: devSecretsStoreName,
    adopt: true,
    delete: false,
  });

  const Cache = Cloudflare.KV.Namespace("DevCache", {
    title: `${resourcePrefix}cache`,
  });

  const Analytics = Cloudflare.D1.Database("DevAnalytics", {
    name: `${resourcePrefix}analytics`,
    adopt: true,
  });

  return { Secrets, Cache, Analytics };
};

const createContext = (accountId: string, devTag: string) => {
  const app = makeApp({
    name: "clawdbox",
    stage: devTag,
    config: {
      adopt: true,
      cloudflare: { account: accountId },
    },
  });

  const state = State.localFs;
  const platform = Layer.mergeAll(NodeContext.layer, FetchHttpClient.layer);
  const alchemy = Layer.provideMerge(
    Layer.mergeAll(state, dotAlchemy, simpleCLI),
    app,
  );

  return Layer.provideMerge(alchemy, platform);
};

const buildVarsArgs = (env: DevEnv): string[] => {
  const apiKey = env.CODEX_API_KEY ?? env.OPENAI_API_KEY;
  const vars: Record<string, string | undefined> = {
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_SECRET_TOKEN: env.TELEGRAM_SECRET_TOKEN,
    CODEX_API_KEY: apiKey,
    OPENAI_API_KEY: apiKey,
    CODEX_PROFILE: env.CODEX_PROFILE,
    CODEX_ARGS: env.CODEX_ARGS,
    MANAGER_CLI_TOKEN: env.MANAGER_CLI_TOKEN,
    CONTAINER_WORKDIR: env.CONTAINER_WORKDIR,
    CONTAINER_REPO_URL: env.CONTAINER_REPO_URL,
    CONTAINER_REPO_BRANCH: env.CONTAINER_REPO_BRANCH,
    MAX_QUEUE_SIZE: env.MAX_QUEUE_SIZE,
    PROGRESS_EDIT_MS: env.PROGRESS_EDIT_MS,
    RUN_START_TIMEOUT_MS: env.RUN_START_TIMEOUT_MS,
    RUN_IDLE_TIMEOUT_MS: env.RUN_IDLE_TIMEOUT_MS,
    RUN_MAX_MS: env.RUN_MAX_MS,
  };

  return Object.entries(vars).flatMap(([key, value]) =>
    value ? ["--var", `${key}:${value}`] : [],
  );
};

const deployDev = Effect.gen(function* () {
  const env = yield* loadDevEnv;
  const apiKey = env.CODEX_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    return yield* Effect.fail(new Error("CODEX_API_KEY or OPENAI_API_KEY is required"));
  }

  const devTag = buildTag(env);
  const safeTagPattern = /^dev(-|$)/;
  if (!safeTagPattern.test(devTag)) {
    return yield* Effect.fail(
      new Error(`Refusing to deploy without a dev CLAWDBOX_DEV_TAG (got "${devTag}")`),
    );
  }

  const resourcePrefix = `clawdbox-${devTag}-`;
  const workerName = `${resourcePrefix}agent-worker`;
  const { Secrets, Cache, Analytics } = makeResources(resourcePrefix, env);

  yield* Effect.logInfo(`=== Deploying Clawdbox Dev (${devTag}) ===`);

  const infra = yield* apply(Secrets, Cache, Analytics);
  yield* Effect.logInfo("Secrets Store ID: " + infra.DevSecrets.storeId);
  yield* Effect.logInfo("KV Namespace ID: " + infra.DevCache.namespaceId);
  yield* Effect.logInfo("D1 Database ID: " + infra.DevAnalytics.databaseId);

  const imageInfo = buildImageRef(env.CLOUDFLARE_ACCOUNT_ID, env, devTag);
  const imageRef = env.AGENT_IMAGE
    ? env.AGENT_IMAGE
    : yield* buildAndPushAgentImage({
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: env.CLOUDFLARE_API_TOKEN,
        repo: imageInfo.repo,
        tag: imageInfo.tag,
        platform: env.AGENT_IMAGE_PLATFORM ?? defaultImagePlatform,
        ttlMinutes: env.AGENT_REGISTRY_TTL_MINUTES ?? defaultRegistryTtlMinutes,
      });

  if (env.AGENT_IMAGE) {
    yield* Effect.logInfo(`Using prebuilt agent image: ${imageRef}`);
  } else {
    yield* Effect.logInfo(`Agent image pushed: ${imageRef}`);
  }

  const varsArgs = buildVarsArgs(env);

  yield* Effect.logInfo("Deploying agent worker via wrangler...");
  yield* withWranglerConfig(
    agentWorkerWranglerPath,
    imageRef,
    workerName,
    (configPath) =>
      runWrangler(["deploy", "--name", workerName, ...varsArgs], configPath),
  );

  const api = yield* Cloudflare.CloudflareApi;
  const accountId = yield* Cloudflare.Account;
  const { subdomain } = yield* api.workers.subdomains.get({ account_id: accountId });
  const workerUrl = `https://${workerName}.${subdomain}.workers.dev`;

  yield* Effect.logInfo(`Agent worker URL: ${workerUrl}`);
  yield* setWebhook(env.TELEGRAM_BOT_TOKEN, `${workerUrl}/webhook`, env.TELEGRAM_SECRET_TOKEN);
  yield* setBotCommands(env.TELEGRAM_BOT_TOKEN, [
    { command: "new", description: "Start a fresh session" },
    { command: "help", description: "Show available commands" },
    { command: "settings", description: "Set this topic as the settings thread" },
    { command: "auth", description: "Store Cloudflare + Codex credentials" },
    { command: "rename", description: "Rename the current topic" },
  ]);
  yield* Effect.logInfo("=== Dev environment ready (webhook set) ===");
});

const destroyDev = Effect.gen(function* () {
  const env = yield* loadDevEnv;
  const devTag = buildTag(env);
  const safeTagPattern = /^dev(-|$)/;
  if (!safeTagPattern.test(devTag)) {
    return yield* Effect.fail(
      new Error(`Refusing to destroy without a dev CLAWDBOX_DEV_TAG (got "${devTag}")`),
    );
  }

  const workerName = `clawdbox-${devTag}-agent-worker`;
  yield* Effect.ignore(runWrangler(["delete", "--name", workerName, "--force"]));
  yield* destroy();
  yield* Effect.logInfo("=== Dev environment destroyed ===");
});

const buildMain = (
  accountId: string,
  devTag: string,
): Effect.Effect<void, unknown, never> =>
  pipe(
    process.argv.includes("--destroy") ? destroyDev : deployDev,
    Effect.provide(Cloudflare.providers()),
    Effect.provide(createContext(accountId, devTag)),
    Logger.withMinimumLogLevel(LogLevel.Info),
  );

Effect.runPromise(
  pipe(
    loadDevEnv,
    Effect.map((env) => buildMain(env.CLOUDFLARE_ACCOUNT_ID, buildTag(env))),
    Effect.flatMap((program) => program),
  ),
)
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
