import { describe, it, expect } from "bun:test";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Logger from "effect/Logger";
import { LogLevel } from "effect";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import { $, apply, destroy, declare } from "alchemy-effect";
import * as Cloudflare from "alchemy-effect/cloudflare";
import * as Data from "effect/Data";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTelegramClient } from "../../telegram-webhook/src/telegram.js";
import type { Update } from "../../telegram-webhook/src/types.js";
import { createE2eContext } from "./setup.ts";

const runE2E = process.env.RUN_TELEGRAM_E2E === "1";
const hasCloudflareAccount = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID);
const hasCloudflareToken = Boolean(process.env.CLOUDFLARE_API_TOKEN);
const e2eTimeoutMs = 10 * 60 * 1000;

const e2eTag = process.env.CLAWDBOX_E2E_TAG ?? "e2e";
const safeTagPattern = /^(e2e|test)(-|$)/;
const isSafeTag = safeTagPattern.test(e2eTag);
if (runE2E && !isSafeTag) {
  throw new Error(
    `Refusing to run E2E without safe CLAWDBOX_E2E_TAG (got "${e2eTag}")`,
  );
}
const shouldRun =
  runE2E && hasCloudflareAccount && hasCloudflareToken && isSafeTag;
const resourcePrefix = `clawdbox-${e2eTag}-`;

const rootDir = path.resolve(import.meta.dirname, "../../..");
const telegramConfigPath = path.join(rootDir, "telegram.json");
const operatorMainPath = path.join(rootDir, "packages", "operator", "src", "index.ts");
const telegramMainPath = path.join(
  rootDir,
  "packages",
  "telegram-webhook",
  "src",
  "index.ts",
);

const logLevel = Logger.withMinimumLogLevel(
  process.env.DEBUG ? LogLevel.Debug : LogLevel.Info,
);

const TelegramConfigSchema = Schema.parseJson(
  Schema.Struct({
    bot_token: Schema.String,
    chat_id: Schema.Union(Schema.Number, Schema.NumberFromString),
  }),
);

const TelegramWebhookResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  result: Schema.Boolean,
});

const TelegramSendMessageResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  result: Schema.Struct({
    message_id: Schema.Number,
  }),
});

const OperatorHealthSchema = Schema.Struct({
  status: Schema.String,
});

type TelegramConfig = Schema.Schema.Type<typeof TelegramConfigSchema>;

const readTelegramConfig = (filePath: string) =>
  pipe(
    Effect.tryPromise({
      try: () => fs.readFile(filePath, "utf8"),
      catch: (error) => new Error(`Failed to read ${filePath}: ${error}`),
    }),
    Effect.flatMap(Schema.decodeUnknown(TelegramConfigSchema)),
    Effect.mapError((error) => new Error(`Invalid telegram.json: ${error}`)),
  );

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
      schedule: Schedule.intersect(Schedule.exponential(500), Schedule.recurs(8)),
    }),
    Effect.asVoid,
  );

const buildWebhookUpdate = (config: TelegramConfig): Update => {
  const now = Math.floor(Date.now() / 1000);
  return {
    update_id: Date.now(),
    message: {
      message_id: now,
      chat: {
        id: config.chat_id,
        type: "private",
      },
      date: now,
      text: "/help",
      from: {
        id: 0,
        is_bot: false,
        first_name: "clawdbox-e2e",
      },
    },
  };
};

describe.if(shouldRun)("Telegram + Cloudflare E2E (Alchemy)", () => {
  it(
    "deploys infra, sends a Telegram message, and tears down",
    async () => {
      const runId = Date.now().toString(36);
      const stage = `${e2eTag}-${runId}`;
      const operatorWorkerName = `${resourcePrefix}operator-${runId}`;
      const telegramWorkerName = `${resourcePrefix}telegram-webhook-${runId}`;
      const teardown = Effect.ignore(destroy());

      const program = Effect.gen(function* () {
        const telegramConfig = yield* readTelegramConfig(telegramConfigPath);

        const api = yield* Cloudflare.CloudflareApi;
        const accountId = yield* Cloudflare.Account;
        const { subdomain } = yield* api.workers.subdomains.get({
          account_id: accountId,
        });

        const operatorUrl = `https://${operatorWorkerName}.${subdomain}.workers.dev`;
        const telegramWorkerUrl = `https://${telegramWorkerName}.${subdomain}.workers.dev`;
        const webhookUrl = `${telegramWorkerUrl}/webhook`;

        const operatorNamespace = Cloudflare.DurableObject.Namespace("OPERATOR", {
          className: "OperatorDO",
          sqlite: true,
        });
        const requireOperatorBinding = declare<
          Cloudflare.DurableObject.Bind<typeof operatorNamespace>
        >();

        class OperatorWorker extends Cloudflare.Worker.serve("OperatorWorker", {
          fetch: Effect.fn(function* () {
            yield* requireOperatorBinding;
            return new Response("ok");
          }),
        })({
          name: operatorWorkerName,
          main: operatorMainPath,
          bindings: $(Cloudflare.DurableObject.Bind(operatorNamespace)),
          compatibility: {
            date: "2024-12-01",
            flags: ["nodejs_compat"],
          },
          migrations: {
            new_tag: stage,
            new_sqlite_classes: ["OperatorDO"],
          },
          subdomain: { enabled: true },
        }) {}

        class TelegramWorker extends Cloudflare.Worker.serve("TelegramWorker", {
          fetch: Effect.fn(function* () {
            return new Response("ok");
          }),
        })({
          name: telegramWorkerName,
          main: telegramMainPath,
          bindings: $(),
          vars: {
            OPERATOR_URL: operatorUrl,
            TELEGRAM_BOT_TOKEN: telegramConfig.bot_token,
          },
          compatibility: {
            date: "2024-12-01",
            flags: ["nodejs_compat"],
          },
          subdomain: { enabled: true },
        }) {}

        yield* apply(OperatorWorker, TelegramWorker);

        yield* waitForWorkerHealth(`${telegramWorkerUrl}/health`);

        const operatorHealth = yield* fetchJson(
          `${operatorUrl}/health`,
          OperatorHealthSchema,
        );
        expect(operatorHealth.status).toBe("ok");

        const setupResponse = yield* fetchJson(
          `${telegramWorkerUrl}/setup`,
          TelegramWebhookResponseSchema,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: webhookUrl }),
          },
        );
        expect(setupResponse.ok).toBe(true);
        expect(setupResponse.result).toBe(true);

        const telegram = createTelegramClient(telegramConfig.bot_token);
        const sendResponse = yield* pipe(
          telegram.sendMessage({
            chat_id: telegramConfig.chat_id,
            text: `clawdbox e2e ping ${Date.now()}`,
          }),
          Effect.flatMap(Schema.decodeUnknown(TelegramSendMessageResponseSchema)),
        );
        expect(sendResponse.ok).toBe(true);

        const update = buildWebhookUpdate(telegramConfig);
        const webhookResponse = yield* Effect.tryPromise({
          try: () =>
            fetch(`${telegramWorkerUrl}/webhook`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(update),
            }),
          catch: (error) => new Error(`Webhook call failed: ${error}`),
        });
        expect(webhookResponse.status).toBe(200);
      }).pipe(
        Effect.ensuring(teardown),
        Effect.provide(Cloudflare.providers()),
        Effect.provide(createE2eContext("clawdbox-e2e", stage)),
        logLevel,
      );

      await Effect.runPromise(program);
    },
    { timeout: e2eTimeoutMs },
  );
});
