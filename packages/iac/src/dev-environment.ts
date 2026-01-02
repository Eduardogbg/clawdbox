/**
 * Deploy a dev environment for takopi.
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
import * as Data from "effect/Data";
import * as Schedule from "effect/Schedule";
import {
  apply,
  destroy,
  make as makeApp,
  State,
  dotAlchemy,
} from "alchemy-effect";
import * as Cloudflare from "alchemy-effect/cloudflare";
import * as Context from "effect/Context";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ReadableStream } from "node:stream/web";
import * as S from "effect/Schema";
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
  TELEGRAM_BOT_TOKEN: S.optional(S.String),
  TAKOPI_BOT_TOKEN: S.optional(S.String),
  TAKOPI_CHAT_ID: S.optional(S.String),
  TAKOPI_IMAGE: S.optional(S.String),
  TAKOPI_IMAGE_REPO: S.optional(S.String),
  TAKOPI_IMAGE_TAG: S.optional(S.String),
  TAKOPI_IMAGE_PLATFORM: S.optional(S.String),
  TAKOPI_REF: S.optional(S.String),
  TAKOPI_REGISTRY_TTL_MINUTES: S.optional(S.NumberFromString),
  TAKOPI_REPO_URL: S.optional(S.String),
  TAKOPI_REPO_BRANCH: S.optional(S.String),
  TAKOPI_WORKDIR: S.optional(S.String),
  CODEX_PROFILE: S.optional(S.String),
  TAKOPI_CODEX_CONFIG_TOML: S.optional(S.String),
  TAKOPI_CODEX_ARGS: S.optional(S.String),
  TAKOPI_ALLOW_GROUP: S.optional(S.String),
  TAKOPI_DELETE_WEBHOOK: S.optional(S.String),
  TAKOPI_STRIP_COMMANDS: S.optional(S.String),
  TAKOPI_DEBUG: S.optional(S.String),
  TAKOPI_FINAL_NOTIFY: S.optional(S.String),
  TAKOPI_LOG_SERVER: S.optional(S.String),
  OPENAI_API_KEY: S.optional(S.String),
  CODEX_API_KEY: S.optional(S.String),
  ANTHROPIC_API_KEY: S.optional(S.String),
  GITHUB_PAT: S.optional(S.String),
});

type DevEnv = S.Schema.Type<typeof DevEnvSchema>;

const loadDevEnv = pipe(
  Effect.succeed(process.env),
  Effect.flatMap(S.decodeUnknown(DevEnvSchema)),
  Effect.mapError((error) => new Error(`Invalid env: ${error}`)),
);

const buildTag = (env: DevEnv) =>
  env.CLAWDBOX_DEV_TAG ?? `dev-${Date.now().toString(36)}`;

const makeResources = (resourcePrefix: string, env: DevEnv) => {
  const Secrets = Cloudflare.SecretsStore.Store("DevSecrets", {
    name: `${resourcePrefix}secrets`,
    secrets: {
      TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN ?? "placeholder",
      TAKOPI_BOT_TOKEN: env.TAKOPI_BOT_TOKEN ?? "placeholder",
      TAKOPI_CHAT_ID: env.TAKOPI_CHAT_ID ?? "0",
      OPENAI_API_KEY: env.OPENAI_API_KEY ?? env.CODEX_API_KEY ?? "placeholder",
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "placeholder",
      GITHUB_PAT: env.GITHUB_PAT ?? "placeholder",
    },
  });

  const Cache = Cloudflare.KV.Namespace("DevCache", {
    title: `${resourcePrefix}cache`,
  });

  const Analytics = Cloudflare.D1.Database("DevAnalytics", {
    name: `${resourcePrefix}analytics`,
  });

  return { Secrets, Cache, Analytics };
};

const takopiWorkerDir = path.resolve(
  import.meta.dirname,
  "../../takopi-worker",
);
const takopiContainerDir = path.resolve(
  import.meta.dirname,
  "../../takopi-container",
);
const takopiWorkerWranglerPath = path.join(takopiWorkerDir, "wrangler.toml");
const defaultImageRepo = "clawdbox-takopi";
const defaultImagePlatform = "linux/amd64";
const defaultRegistryTtlMinutes = 60;
const defaultTakopiRef = "8eda3f5e84f960e6961ee1e05ae24a23752e16e7";
const textEncoder = new TextEncoder();

const readStreamText = async (
  stream: ReadableStream<Uint8Array> | null | undefined,
): Promise<string> => {
  if (!stream) return "";
  return await new Response(stream).text();
};

const isWritableStream = (
  value: unknown,
): value is WritableStream<Uint8Array> =>
  typeof (value as WritableStream<Uint8Array>)?.getWriter === "function";

const isNodeWritable = (
  value: unknown,
): value is {
  write: (chunk: string, cb?: (error?: Error | null) => void) => void;
  end?: (cb?: () => void) => void;
} =>
  typeof (value as { write?: unknown }).write === "function";

type CommandResult = {
  stdout: string;
  stderr: string;
};

type CommandInput = {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  stdio?: "pipe" | "inherit";
};

const runCommand = (input: CommandInput) =>
  Effect.tryPromise({
    try: async (): Promise<CommandResult> => {
      const stdio = input.stdio ?? "pipe";
      const proc = Bun.spawn({
        cmd: input.cmd,
        cwd: input.cwd,
        env: input.env,
        stdout: stdio,
        stderr: stdio,
        stdin: input.stdin ? "pipe" : "ignore",
      });

      const stdinText = input.stdin;
      if (stdinText !== undefined) {
        const stdin = proc.stdin;
        if (!stdin) {
          throw new Error("Failed to open stdin pipe");
        }
        if (isWritableStream(stdin)) {
          const writer = stdin.getWriter();
          await writer.write(textEncoder.encode(stdinText));
          await writer.close();
        } else if (isNodeWritable(stdin)) {
          await new Promise<void>((resolve, reject) => {
            if (stdin.write.length < 2) {
              stdin.write(stdinText);
              if (stdin.end) {
                stdin.end(() => resolve());
              } else {
                resolve();
              }
              return;
            }
            stdin.write(stdinText, (error) => {
              if (error) return reject(error);
              if (stdin.end) {
                stdin.end(() => resolve());
              } else {
                resolve();
              }
            });
          });
        } else {
          throw new Error("Unsupported stdin interface");
        }
      }

      const exitCode = await proc.exited;
      const stdout =
        stdio === "pipe" ? await readStreamText(proc.stdout) : "";
      const stderr =
        stdio === "pipe" ? await readStreamText(proc.stderr) : "";

      if (exitCode !== 0) {
        throw new Error(
          `${input.cmd.join(" ")} failed (${exitCode}): ${stderr || stdout}`,
        );
      }

      return { stdout, stderr };
    },
    catch: (error) =>
      new Error(`${input.cmd.join(" ")} failed: ${error}`),
  });

const runWrangler = (args: string[], configPath?: string) => {
  const configArgs = configPath ? ["--config", configPath] : [];
  return runCommand({
    cmd: ["npx", "wrangler", ...configArgs, ...args],
    cwd: takopiWorkerDir,
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? "",
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    },
  });
};

const sanitizeImageTag = (tag: string) =>
  tag.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");

const buildImageRef = (accountId: string, env: DevEnv, devTag: string) => {
  const repo = env.TAKOPI_IMAGE_REPO ?? defaultImageRepo;
  const tag = sanitizeImageTag(env.TAKOPI_IMAGE_TAG ?? devTag);
  return { repo, tag, ref: `registry.cloudflare.com/${accountId}/${repo}:${tag}` };
};

const RegistryErrorSchema = S.Struct({
  code: S.Number,
  message: S.String,
});

const RegistryCredentialsResponseSchema = S.Struct({
  success: S.Boolean,
  result: S.optional(
    S.Struct({
      username: S.String,
      password: S.String,
    }),
  ),
  errors: S.optional(S.Array(RegistryErrorSchema)),
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
  takopiRef: string;
  ttlMinutes: number;
};

const buildAndPushTakopiImage = (input: BuildImageInput) =>
  withTempDir("clawdbox-takopi-", (workDir) =>
    Effect.gen(function* () {
      const imageRef = `registry.cloudflare.com/${input.accountId}/${input.repo}:${input.tag}`;
      const localTag = `${input.repo}:${input.tag}`;
      const tarPath = path.join(workDir, "takopi-image.tar");
      const dockerfilePath = path.join(takopiContainerDir, "Dockerfile");

      yield* Effect.logInfo(`Building takopi image (${localTag})...`);
      yield* runCommand({
        cmd: ["docker", "info"],
      });
      yield* runCommand({
        cmd: [
          "docker",
          "build",
          "--platform",
          input.platform,
          "--build-arg",
          `TAKOPI_REF=${input.takopiRef}`,
          "-t",
          localTag,
          "-f",
          dockerfilePath,
          takopiContainerDir,
        ],
        stdio: "inherit",
      });

      yield* runCommand({
        cmd: ["docker", "save", localTag, "-o", tarPath],
      });

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
            Effect.logInfo("Pushing takopi image via crane..."),
          ),
          Effect.flatMap(() =>
            runCommand({
              cmd: ["crane", "-v", "push", tarPath, imageRef],
              env: {
                ...process.env,
                DOCKER_CONFIG: configDir,
              },
              stdio: "inherit",
            }),
          ),
          Effect.as(imageRef),
        ),
      );
    }),
  );

type StartPayload = {
  botToken: string;
  chatId: number;
  repoUrl: string;
  repoBranch?: string;
  workdir?: string;
  openAiApiKey: string;
  codexProfile?: string;
  codexConfigToml?: string;
  codexArgs?: string;
  logServer?: boolean;
  allowGroup?: boolean;
  deleteWebhook?: boolean;
  stripCommands?: boolean;
  finalNotify?: boolean;
  debug?: boolean;
  githubPat?: string;
};

const parseBooleanEnv = (value: string | undefined) =>
  value === "1" || value === "true";

const buildStartPayload = (env: DevEnv) => {
  const missing: string[] = [];
  const botToken = env.TAKOPI_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN;
  if (!botToken) missing.push("TAKOPI_BOT_TOKEN");

  const chatIdRaw = env.TAKOPI_CHAT_ID;
  const chatId = chatIdRaw ? Number(chatIdRaw) : Number.NaN;
  if (!Number.isFinite(chatId)) missing.push("TAKOPI_CHAT_ID");

  const repoUrl = env.TAKOPI_REPO_URL;
  if (!repoUrl) missing.push("TAKOPI_REPO_URL");

  const openAiApiKey = env.OPENAI_API_KEY ?? env.CODEX_API_KEY;
  if (!openAiApiKey) missing.push("OPENAI_API_KEY");

  if (missing.length > 0) {
    return Effect.fail(
      new Error(`Missing env for auto-start: ${missing.join(", ")}`),
    );
  }

  const payload: StartPayload = {
    botToken: botToken ?? "",
    chatId,
    repoUrl: repoUrl ?? "",
    repoBranch: env.TAKOPI_REPO_BRANCH,
    workdir: env.TAKOPI_WORKDIR,
    openAiApiKey: openAiApiKey ?? "",
    codexProfile: env.CODEX_PROFILE,
    codexConfigToml: env.TAKOPI_CODEX_CONFIG_TOML,
    codexArgs: env.TAKOPI_CODEX_ARGS,
    logServer: parseBooleanEnv(env.TAKOPI_LOG_SERVER),
    allowGroup:
      env.TAKOPI_ALLOW_GROUP !== undefined
        ? parseBooleanEnv(env.TAKOPI_ALLOW_GROUP)
        : chatId < 0,
    deleteWebhook:
      env.TAKOPI_DELETE_WEBHOOK !== undefined
        ? parseBooleanEnv(env.TAKOPI_DELETE_WEBHOOK)
        : true,
    stripCommands:
      env.TAKOPI_STRIP_COMMANDS !== undefined
        ? parseBooleanEnv(env.TAKOPI_STRIP_COMMANDS)
        : true,
    finalNotify: parseBooleanEnv(env.TAKOPI_FINAL_NOTIFY),
    debug: parseBooleanEnv(env.TAKOPI_DEBUG),
    githubPat: env.GITHUB_PAT,
  };

  return Effect.succeed(payload);
};

const WorkerHealthSchema = S.Struct({
  status: S.String,
});

const StartResponseSchema = S.Struct({
  status: S.String,
  instanceId: S.String,
});

class WorkerNotReady extends Data.TaggedError("WorkerNotReady")<{
  readonly status: number;
}> {}

class ContainerNotReady extends Data.TaggedError("ContainerNotReady")<{
  readonly status: string;
}> {}

const fetchJson = <A, I, R>(
  url: string,
  schema: S.Schema<A, I, R>,
  init?: RequestInit,
) =>
  pipe(
    Effect.tryPromise({
      try: () => fetch(url, init),
      catch: (error) => new Error(`Fetch failed for ${url}: ${error}`),
    }),
    Effect.flatMap((response) =>
      response.ok
        ? Effect.tryPromise({
            try: () => response.json(),
            catch: (error) => new Error(`Invalid JSON from ${url}: ${error}`),
          })
        : Effect.fail(new Error(`HTTP ${response.status} for ${url}`)),
    ),
    Effect.flatMap(S.decodeUnknown(schema)),
    Effect.mapError((error) => new Error(`Failed to decode ${url}: ${error}`)),
  );

const waitForWorkerHealth = (url: string) =>
  pipe(
    Effect.tryPromise({
      try: () => fetch(url, { method: "GET" }),
      catch: (error) => new Error(`Health check failed for ${url}: ${error}`),
    }),
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(new WorkerNotReady({ status: response.status })),
    ),
    Effect.retry({
      while: (error): error is WorkerNotReady => error instanceof WorkerNotReady,
      schedule: Schedule.intersect(Schedule.exponential(500), Schedule.recurs(12)),
    }),
    Effect.flatMap(() => fetchJson(url, WorkerHealthSchema)),
    Effect.asVoid,
  );

const ContainerStatusSchema = S.Struct({
  status: S.String,
});

const fetchContainerStatus = (url: string) => fetchJson(url, ContainerStatusSchema);

const waitForContainerStatus = (url: string, target: string) =>
  pipe(
    fetchContainerStatus(url),
    Effect.flatMap((status) =>
      status.status === target
        ? Effect.succeed(status)
        : Effect.fail(new ContainerNotReady({ status: status.status })),
    ),
    Effect.retry({
      while: (error): error is ContainerNotReady =>
        error instanceof ContainerNotReady,
      schedule: Schedule.intersect(Schedule.exponential(1000), Schedule.recurs(12)),
    }),
    Effect.asVoid,
  );

const waitForContainerRunning = (url: string) =>
  waitForContainerStatus(url, "running");

const waitForContainerStopped = (url: string) =>
  pipe(
    fetchContainerStatus(url),
    Effect.flatMap((status) =>
      status.status === "stopped" || status.status === "idle"
        ? Effect.succeed(status)
        : Effect.fail(new ContainerNotReady({ status: status.status })),
    ),
    Effect.retry({
      while: (error): error is ContainerNotReady =>
        error instanceof ContainerNotReady,
      schedule: Schedule.intersect(Schedule.exponential(1000), Schedule.recurs(12)),
    }),
    Effect.asVoid,
  );

const startContainer = (workerUrl: string, payload: StartPayload) =>
  pipe(
    Effect.tryPromise({
      try: () =>
        fetch(`${workerUrl}/takopi/dev/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      catch: (error) =>
        new Error(`Start request failed for ${workerUrl}: ${error}`),
    }),
    Effect.flatMap((response) => {
      if (response.status === 409) {
        return Effect.logInfo("Takopi container already running");
      }
      if (!response.ok) {
        return Effect.fail(
          new Error(`Start request failed (${response.status})`),
        );
      }
      return pipe(
        Effect.tryPromise({
          try: () => response.json(),
          catch: (error) =>
            new Error(`Invalid start response JSON: ${error}`),
        }),
        Effect.flatMap(S.decodeUnknown(StartResponseSchema)),
        Effect.tap((start) =>
          Effect.logInfo(
            `Takopi container start response: ${start.status} (${start.instanceId})`,
          ),
        ),
      );
    }),
  );

const stopContainer = (workerUrl: string) =>
  Effect.tryPromise({
    try: () =>
      fetch(`${workerUrl}/takopi/dev/stop`, {
        method: "POST",
      }),
    catch: (error) =>
      new Error(`Stop request failed for ${workerUrl}: ${error}`),
  });

const createContext = (accountId: string, devTag: string) => {
  const app = makeApp({
    name: "clawdbox",
    stage: devTag,
    config: {
      adopt: true,
      cloudflare: {
        account: accountId,
      },
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

const deployDev = Effect.gen(function* () {
  const env = yield* loadDevEnv;
  const devTag = buildTag(env);
  const safeTagPattern = /^dev(-|$)/;
  if (!safeTagPattern.test(devTag)) {
    return yield* Effect.fail(
      new Error(
        `Refusing to deploy without a dev CLAWDBOX_DEV_TAG (got "${devTag}")`,
      ),
    );
  }

  const resourcePrefix = `clawdbox-${devTag}-`;
  const workerName = `${resourcePrefix}takopi-worker`;
  const { Secrets, Cache, Analytics } = makeResources(resourcePrefix, env);

  yield* Effect.logInfo(`=== Deploying Clawdbox Dev (${devTag}) ===`);

  const infra = yield* apply(Secrets, Cache, Analytics);

  yield* Effect.logInfo("Secrets Store ID: " + infra.DevSecrets.storeId);
  yield* Effect.logInfo("KV Namespace ID: " + infra.DevCache.namespaceId);
  yield* Effect.logInfo("D1 Database ID: " + infra.DevAnalytics.databaseId);

  const imageInfo = buildImageRef(env.CLOUDFLARE_ACCOUNT_ID, env, devTag);
  const imageRef = env.TAKOPI_IMAGE
    ? env.TAKOPI_IMAGE
    : yield* buildAndPushTakopiImage({
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: env.CLOUDFLARE_API_TOKEN,
        repo: imageInfo.repo,
        tag: imageInfo.tag,
        platform: env.TAKOPI_IMAGE_PLATFORM ?? defaultImagePlatform,
        takopiRef: env.TAKOPI_REF ?? defaultTakopiRef,
        ttlMinutes: env.TAKOPI_REGISTRY_TTL_MINUTES ?? defaultRegistryTtlMinutes,
      });

  if (env.TAKOPI_IMAGE) {
    yield* Effect.logInfo(`Using prebuilt takopi image: ${imageRef}`);
  } else {
    yield* Effect.logInfo(`Takopi image pushed: ${imageRef}`);
  }

  yield* Effect.logInfo("Deploying takopi worker via wrangler...");
  yield* withWranglerConfig(takopiWorkerWranglerPath, imageRef, (configPath) =>
    runWrangler(["deploy", "--name", workerName], configPath),
  );

  const api = yield* Cloudflare.CloudflareApi;
  const accountId = yield* Cloudflare.Account;
  const { subdomain } = yield* api.workers.subdomains.get({
    account_id: accountId,
  });

  const workerUrl = `https://${workerName}.${subdomain}.workers.dev`;

  yield* Effect.logInfo(`Takopi worker URL: ${workerUrl}`);
  yield* Effect.logInfo("Waiting for worker to become healthy...");
  yield* waitForWorkerHealth(`${workerUrl}/`);

  const startPayload = yield* buildStartPayload(env);
  const statusUrl = `${workerUrl}/takopi/dev/status`;

  yield* Effect.logInfo("Checking for existing container...");
  const currentStatus = yield* Effect.catchAll(
    fetchContainerStatus(statusUrl),
    () => Effect.succeed({ status: "unknown" }),
  );
  if (currentStatus.status === "running" || currentStatus.status === "starting") {
    yield* Effect.logInfo("Stopping existing container...");
    yield* stopContainer(workerUrl);
    yield* waitForContainerStopped(statusUrl);
  }

  yield* Effect.logInfo("Starting takopi container...");
  yield* startContainer(workerUrl, startPayload);
  yield* Effect.logInfo("Waiting for container to report running...");
  yield* waitForContainerRunning(statusUrl);

  yield* Effect.logInfo("=== Dev environment ready (container started) ===");
});

const destroyDev = Effect.gen(function* () {
  const env = yield* loadDevEnv;
  const devTag = buildTag(env);
  const safeTagPattern = /^dev(-|$)/;
  if (!safeTagPattern.test(devTag)) {
    return yield* Effect.fail(
      new Error(
        `Refusing to destroy without a dev CLAWDBOX_DEV_TAG (got "${devTag}")`,
      ),
    );
  }

  const resourcePrefix = `clawdbox-${devTag}-`;

  yield* Effect.logInfo(`=== Destroying Clawdbox Dev (${devTag}) ===`);

  const workerName = `${resourcePrefix}takopi-worker`;
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
