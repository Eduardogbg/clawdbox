import { describe, it, expect } from "bun:test";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createTelegramClient } from "../src/telegram.js";
import type { Update } from "../src/types.js";

const runE2E = process.env.RUN_TELEGRAM_E2E === "1";
const hasCloudflareAccount = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID);
const shouldRun = runE2E && hasCloudflareAccount;
const e2eTimeoutMs = 10 * 60 * 1000;

const rootDir = path.resolve(import.meta.dirname, "../../../");
const telegramConfigPath = path.join(rootDir, "telegram.json");
const operatorDir = path.join(rootDir, "packages", "operator");
const telegramDir = path.join(rootDir, "packages", "telegram-webhook");
const telegramWranglerPath = path.join(telegramDir, "wrangler.toml");

const TelegramConfigSchema = Schema.parseJson(
  Schema.Struct({
    bot_token: Schema.String,
    chat_id: Schema.Union(Schema.Number, Schema.NumberFromString),
  }),
);

const CloudflareSubdomainSchema = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Struct({
    subdomain: Schema.String,
  }),
});

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

const runCommand = (
  command: string,
  args: Array<string>,
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    input?: string;
  },
) =>
  Effect.try({
    try: () => {
      const result = spawnSync(command, args, {
        cwd: options.cwd,
        env: options.env,
        input: options.input,
        stdio: ["pipe", "inherit", "inherit"],
      });
      if (result.status !== 0) {
        throw new Error(
          `${command} ${args.join(" ")} failed with code ${result.status}`,
        );
      }
    },
    catch: (error) => new Error(`Command failed: ${error}`),
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

const getWorkersSubdomain = (accountId: string, apiToken: string) =>
  fetchJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    CloudflareSubdomainSchema,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    },
  ).pipe(
    Effect.flatMap((data) =>
      data.success
        ? Effect.succeed(data.result.subdomain)
        : Effect.fail(new Error("Cloudflare subdomain lookup failed")),
    ),
  );

const parseWorkersSubdomain = (url: string): string | null => {
  const match = url.match(/^https?:\/\/[^.]+\.([^.]+)\.workers\.dev/);
  return match?.[1] ?? null;
};

const readWorkersSubdomainFromWrangler = () =>
  pipe(
    Effect.tryPromise({
      try: () => fs.readFile(telegramWranglerPath, "utf8"),
      catch: (error) =>
        new Error(`Failed to read ${telegramWranglerPath}: ${error}`),
    }),
    Effect.flatMap((content) => {
      const match = content.match(/OPERATOR_URL\s*=\s*"([^"]+)"/);
      const operatorUrl = match?.[1];
      const subdomain = operatorUrl ? parseWorkersSubdomain(operatorUrl) : null;
      return subdomain
        ? Effect.succeed(subdomain)
        : Effect.fail(
            new Error("Unable to determine Workers subdomain from wrangler.toml"),
          );
    }),
  );

const resolveWorkersSubdomain = (accountId: string, apiToken: string | null) => {
  const envSubdomain = process.env.CLOUDFLARE_WORKERS_SUBDOMAIN;
  if (envSubdomain) {
    return Effect.succeed(envSubdomain);
  }

  if (apiToken) {
    return getWorkersSubdomain(accountId, apiToken).pipe(
      Effect.catchAll(() => readWorkersSubdomainFromWrangler()),
    );
  }

  return readWorkersSubdomainFromWrangler();
};

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

describe.if(shouldRun)("Telegram + Cloudflare E2E", () => {
  it(
    "deploys workers, configures webhook, and sends a Telegram message",
    async () => {
      const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? null;
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";

      const env = {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        ...(apiToken ? { CLOUDFLARE_API_TOKEN: apiToken } : {}),
      };

      const telegramConfig = await Effect.runPromise(
        readTelegramConfig(telegramConfigPath),
      );

      const subdomain = await Effect.runPromise(
        resolveWorkersSubdomain(accountId, apiToken),
      );

      const operatorUrl = `https://clawdbox-operator.${subdomain}.workers.dev`;
      const telegramWorkerName = "clawdbox-telegram-webhook-staging";
      const telegramWorkerUrl = `https://${telegramWorkerName}.${subdomain}.workers.dev`;
      const webhookUrl = `${telegramWorkerUrl}/webhook`;

      await Effect.runPromise(
        runCommand("bun", ["run", "deploy"], { cwd: operatorDir, env }),
      );

      await Effect.runPromise(
        runCommand(
          "bunx",
          ["wrangler", "secret", "put", "TELEGRAM_BOT_TOKEN", "--env", "staging"],
          {
            cwd: telegramDir,
            env,
            input: `${telegramConfig.bot_token}\n`,
          },
        ),
      );

      await Effect.runPromise(
        runCommand(
          "bunx",
          [
            "wrangler",
            "deploy",
            "--env",
            "staging",
            "--var",
            `OPERATOR_URL=${operatorUrl}`,
          ],
          { cwd: telegramDir, env },
        ),
      );

      await Effect.runPromise(
        waitForWorkerHealth(`${telegramWorkerUrl}/health`),
      );

      const operatorHealth = await Effect.runPromise(
        fetchJson(`${operatorUrl}/health`, OperatorHealthSchema),
      );
      expect(operatorHealth.status).toBe("ok");

      const setupResponse = await Effect.runPromise(
        fetchJson(`${telegramWorkerUrl}/setup`, TelegramWebhookResponseSchema, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: webhookUrl }),
        }),
      );
      expect(setupResponse.ok).toBe(true);
      expect(setupResponse.result).toBe(true);

      const telegram = createTelegramClient(telegramConfig.bot_token);
      const sendResponse = await Effect.runPromise(
        pipe(
          telegram.sendMessage({
            chat_id: telegramConfig.chat_id,
            text: `clawdbox e2e ping ${Date.now()}`,
          }),
          Effect.flatMap(Schema.decodeUnknown(TelegramSendMessageResponseSchema)),
        ),
      );
      expect(sendResponse.ok).toBe(true);

      const update = buildWebhookUpdate(telegramConfig);
      const webhookResponse = await fetch(`${telegramWorkerUrl}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      expect(webhookResponse.status).toBe(200);
    },
    { timeout: e2eTimeoutMs },
  );
});
