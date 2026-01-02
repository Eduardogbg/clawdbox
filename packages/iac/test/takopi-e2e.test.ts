import { describe, it, expect } from "bun:test";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Logger from "effect/Logger";
import { LogLevel } from "effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Data from "effect/Data";
import * as Cloudflare from "alchemy-effect/cloudflare";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { ReadableStream } from "node:stream/web";
import { createE2eContext } from "./setup.ts";
import { withWranglerConfig } from "../src/wrangler-config.ts";

const runE2E = process.env.RUN_TAKOPI_E2E === "1";
const hasCloudflareAccount = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID);
const hasCloudflareToken = Boolean(process.env.CLOUDFLARE_API_TOKEN);
const hasBotToken = Boolean(process.env.TAKOPI_BOT_TOKEN);
const chatIdValue = Number(process.env.TAKOPI_CHAT_ID);
const hasChatId = Number.isFinite(chatIdValue);
const hasRepoUrl = Boolean(process.env.TAKOPI_REPO_URL);
const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
const takopiImage = process.env.TAKOPI_IMAGE;
const hasTakopiImage = Boolean(takopiImage);

const hasDocker = hasTakopiImage
  ? true
  : (() => {
      try {
        execSync("docker info", { stdio: "pipe" });
        return true;
      } catch {
        return false;
      }
    })();

const e2eTag = process.env.CLAWDBOX_E2E_TAG ?? "e2e";
const safeTagPattern = /^(e2e|test)(-|$)/;
const isSafeTag = safeTagPattern.test(e2eTag);
if (runE2E && !isSafeTag) {
  throw new Error(
    `Refusing to run E2E without safe CLAWDBOX_E2E_TAG (got "${e2eTag}")`,
  );
}

const shouldRun =
  runE2E &&
  hasCloudflareAccount &&
  hasCloudflareToken &&
  hasDocker &&
  hasBotToken &&
  hasChatId &&
  hasRepoUrl &&
  hasOpenAiKey &&
  isSafeTag;

const rootDir = path.resolve(import.meta.dirname, "../../..");
const takopiWorkerDir = path.join(rootDir, "packages", "takopi-worker");
const takopiWorkerWranglerPath = path.join(takopiWorkerDir, "wrangler.toml");
const e2eTimeoutMs = 15 * 60 * 1000;
const resourcePrefix = `clawdbox-${e2eTag}-`;

const logLevel = Logger.withMinimumLogLevel(
  process.env.DEBUG ? LogLevel.Debug : LogLevel.Info,
);

const WorkerHealthSchema = Schema.Struct({
  status: Schema.String,
});

const StartResponseSchema = Schema.Struct({
  status: Schema.String,
  instanceId: Schema.String,
});

const TakopiStatusSchema = Schema.Struct({
  status: Schema.String,
  instanceId: Schema.Union(Schema.String, Schema.Null),
  config: Schema.Unknown,
  startedAt: Schema.Union(Schema.Number, Schema.Null),
  stoppedAt: Schema.Union(Schema.Number, Schema.Null),
  error: Schema.Union(Schema.String, Schema.Null),
});

type TakopiStatus = Schema.Schema.Type<typeof TakopiStatusSchema>;

type WranglerResult = {
  stdout: string;
  stderr: string;
};

const readStreamText = async (
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> => {
  if (!stream) return "";
  return await new Response(stream).text();
};

const runWrangler = (args: string[], cwd: string) =>
  Effect.tryPromise({
    try: async (): Promise<WranglerResult> => {
      const proc = Bun.spawn({
        cmd: ["npx", "wrangler", ...args],
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await readStreamText(proc.stdout);
      const stderr = await readStreamText(proc.stderr);

      if (exitCode !== 0) {
        throw new Error(
          `wrangler ${args.join(" ")} failed (${exitCode}): ${stderr || stdout}`,
        );
      }

      return { stdout, stderr };
    },
    catch: (error) => new Error(`wrangler ${args.join(" ")} failed: ${error}`),
  });

const fetchJson = <A, I, R>(
  url: string,
  schema: Schema.Schema<A, I, R>,
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
    Effect.flatMap(Schema.decodeUnknown(schema)),
    Effect.mapError((error) => new Error(`Failed to decode ${url}: ${error}`)),
  );

class WorkerNotReady extends Data.TaggedError("WorkerNotReady")<{
  readonly status: number;
}> {}

class ContainerNotReady extends Data.TaggedError("ContainerNotReady")<{
  readonly status: string;
}> {}

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
      schedule: Schedule.intersect(Schedule.exponential(500), Schedule.recurs(10)),
    }),
    Effect.asVoid,
  );

const waitForContainerStatus = (url: string, target: string) =>
  pipe(
    fetchJson(url, TakopiStatusSchema),
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
  );

const buildStartConfig = () => ({
  botToken: process.env.TAKOPI_BOT_TOKEN ?? "",
  chatId: chatIdValue,
  repoUrl: process.env.TAKOPI_REPO_URL ?? "",
  repoBranch: process.env.TAKOPI_REPO_BRANCH,
  workdir: process.env.TAKOPI_WORKDIR,
  openAiApiKey: process.env.OPENAI_API_KEY,
  codexProfile: process.env.CODEX_PROFILE,
  codexConfigToml: process.env.TAKOPI_CODEX_CONFIG_TOML,
  finalNotify: false,
  debug: process.env.TAKOPI_DEBUG === "1",
  githubPat: process.env.GITHUB_PAT,
});

describe.if(shouldRun)("Takopi + Containers E2E (Wrangler)", () => {
  it(
    "deploys takopi worker, starts container, and stops cleanly",
    async () => {
      const runId = Date.now().toString(36);
      const workerName = `${resourcePrefix}takopi-${runId}`;
      const instanceId = `takopi-${runId}`;

      const cleanup = Effect.gen(function* () {
        yield* Effect.ignore(
          runWrangler(["delete", "--name", workerName, "--force"], takopiWorkerDir),
        );
      });

      const program = Effect.gen(function* () {
        const api = yield* Cloudflare.CloudflareApi;
        const accountId = yield* Cloudflare.Account;
        const { subdomain } = yield* api.workers.subdomains.get({
          account_id: accountId,
        });

        if (takopiImage) {
          yield* withWranglerConfig(
            takopiWorkerWranglerPath,
            takopiImage,
            (configPath) =>
              runWrangler(
                ["deploy", "--name", workerName, "--config", configPath],
                takopiWorkerDir,
              ),
          );
        } else {
          yield* runWrangler(["deploy", "--name", workerName], takopiWorkerDir);
        }

        const workerUrl = `https://${workerName}.${subdomain}.workers.dev`;

        yield* waitForWorkerHealth(`${workerUrl}/`);
        const health = yield* fetchJson(`${workerUrl}/`, WorkerHealthSchema);
        expect(health.status).toBe("ok");

        const startResponse = yield* fetchJson(
          `${workerUrl}/takopi/${instanceId}/start`,
          StartResponseSchema,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildStartConfig()),
          },
        );
        expect(startResponse.status).toBe("started");

        const runningStatus = yield* waitForContainerStatus(
          `${workerUrl}/takopi/${instanceId}/status`,
          "running",
        );
        expect(runningStatus.status).toBe("running");

        yield* Effect.tryPromise({
          try: () =>
            fetch(`${workerUrl}/takopi/${instanceId}/stop`, {
              method: "POST",
            }),
          catch: (error) => new Error(`Stop request failed: ${error}`),
        });

        const stoppedStatus = yield* waitForContainerStatus(
          `${workerUrl}/takopi/${instanceId}/status`,
          "stopped",
        );
        expect(stoppedStatus.status).toBe("stopped");
      }).pipe(
        Effect.ensuring(cleanup),
        Effect.provide(Cloudflare.providers()),
        Effect.provide(createE2eContext("clawdbox-e2e", `${e2eTag}-${runId}`)),
        logLevel,
      );

      await Effect.runPromise(program);
    },
    { timeout: e2eTimeoutMs },
  );
});

// Guardrail test to surface missing prereqs
const isMissingPrereqs = runE2E && !shouldRun;

describe.if(isMissingPrereqs)("Takopi E2E prereqs", () => {
  it("reports missing prerequisites", () => {
    const missing: string[] = [];
    if (!hasCloudflareAccount) missing.push("CLOUDFLARE_ACCOUNT_ID");
    if (!hasCloudflareToken) missing.push("CLOUDFLARE_API_TOKEN");
    if (!hasDocker) missing.push("Docker (or set TAKOPI_IMAGE)");
    if (!hasBotToken) missing.push("TAKOPI_BOT_TOKEN");
    if (!hasChatId) missing.push("TAKOPI_CHAT_ID");
    if (!hasRepoUrl) missing.push("TAKOPI_REPO_URL");
    if (!hasOpenAiKey) missing.push("OPENAI_API_KEY");

    expect(missing.length).toBeGreaterThan(0);
  });
});
