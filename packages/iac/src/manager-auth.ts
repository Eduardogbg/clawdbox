/**
 * CLI helper to register credentials with the Manager DO.
 */
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as S from "effect/Schema";
import { config } from "dotenv";
import * as readline from "node:readline/promises";

config({ path: ".env" });

const RegisterSchema = S.Struct({
  chat_id: S.Number,
  cloudflare_account_id: S.String,
  cloudflare_api_token: S.String,
  codex_api_key: S.String,
});

type RegisterInput = S.Schema.Type<typeof RegisterSchema>;

const ask = (rl: readline.Interface, prompt: string) =>
  Effect.tryPromise({
    try: () => rl.question(prompt),
    catch: (error) => new Error(`Prompt failed: ${error}`),
  });

const parseChatId = (value: string) => {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new Error("chat id must be a number");
  }
  return parsed;
};

const main = Effect.gen(function* () {
  const urlArgIndex = process.argv.indexOf("--url");
  const url =
    (urlArgIndex >= 0 ? process.argv[urlArgIndex + 1] : null) ??
    process.env.MANAGER_URL ??
    "";
  if (!url) {
    return yield* Effect.fail(new Error("MANAGER_URL or --url is required"));
  }
  const cliToken = process.env.MANAGER_CLI_TOKEN;
  if (!cliToken) {
    return yield* Effect.fail(new Error("MANAGER_CLI_TOKEN is required"));
  }

  const result = yield* pipe(
    Effect.try({
      try: () =>
        readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        }),
      catch: (error) => new Error(`Failed to open prompt: ${error}`),
    }),
    Effect.flatMap((handle) =>
      pipe(
        Effect.gen(function* () {
          const chatIdRaw = yield* ask(handle, "Telegram chat id: ");
          const accountId = yield* ask(handle, "Cloudflare account id: ");
          const cfToken = yield* ask(handle, "Cloudflare API token: ");
          const codexKey = yield* ask(handle, "Codex/OpenAI API key: ");

          const payload: RegisterInput = {
            chat_id: parseChatId(chatIdRaw),
            cloudflare_account_id: accountId.trim(),
            cloudflare_api_token: cfToken.trim(),
            codex_api_key: codexKey.trim(),
          };

          const decoded = yield* pipe(
            Effect.succeed(payload),
            Effect.flatMap(S.decodeUnknown(RegisterSchema)),
            Effect.mapError((error) => new Error(`Invalid input: ${error}`)),
          );

          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${url.replace(/\/$/, "")}/cli/register`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${cliToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(decoded),
              }),
            catch: (error) => new Error(`Request failed: ${error}`),
          });

          if (!response.ok) {
            const text = yield* Effect.tryPromise({
              try: () => response.text(),
              catch: (error) => new Error(`Failed reading response: ${error}`),
            });
            return yield* Effect.fail(
              new Error(`Register failed (${response.status}): ${text}`),
            );
          }

          const body = yield* Effect.tryPromise({
            try: () => response.json(),
            catch: (error) => new Error(`Failed parsing response: ${error}`),
          });

          console.log("Registered credentials:", body);
          return body;
        }),
        Effect.ensuring(
          Effect.catchAll(
            Effect.try({
              try: () => handle.close(),
              catch: (error) => new Error(`Failed closing prompt: ${error}`),
            }),
            () => Effect.void,
          ),
        ),
      ),
    ),
  );

  return result;
});

Effect.runPromise(main)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
