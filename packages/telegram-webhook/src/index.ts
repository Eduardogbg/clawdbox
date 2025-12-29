/**
 * Telegram Webhook Worker
 *
 * Cloudflare Worker that receives Telegram webhook updates
 * and routes them to the Operator Durable Object.
 */
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import { LogLevel, Logger } from "effect";
import type { Update } from "./types.js";
import { createTelegramClient } from "./telegram.js";
import { createOperatorClient } from "./operator-client.js";
import { handleUpdate } from "./handler.js";

/**
 * Environment bindings
 */
interface Env {
  // Secrets
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;

  // Durable Objects
  // OPERATOR: DurableObjectNamespace;

  // Configuration
  OPERATOR_URL?: string;
}

/**
 * Main Worker handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Webhook endpoint
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    // Setup endpoint (for setting webhook URL)
    if (url.pathname === "/setup" && request.method === "POST") {
      return handleSetup(request, env);
    }

    // Webhook info endpoint
    if (url.pathname === "/webhook-info" && request.method === "GET") {
      return handleWebhookInfo(env);
    }

    return new Response("Not found", { status: 404 });
  },
};

/**
 * Handle incoming webhook from Telegram
 */
async function handleWebhook(request: Request, env: Env): Promise<Response> {
  try {
    // Verify secret token if configured
    if (env.WEBHOOK_SECRET) {
      const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secretHeader !== env.WEBHOOK_SECRET) {
        console.error("Invalid webhook secret");
        return new Response("Unauthorized", { status: 401 });
      }
    }

    // Parse update
    const update = (await request.json()) as Update;
    console.log(`Received update ${update.update_id}`);

    // Create clients
    const telegram = createTelegramClient(env.TELEGRAM_BOT_TOKEN);
    const operatorUrl = env.OPERATOR_URL ?? "";
    const operator = createOperatorClient(operatorUrl);

    // Handle update
    const program = pipe(
      handleUpdate(update, {
        telegram,
        operator,
        operatorUrl,
      }),
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          console.error("Error handling update:", error);
          // Don't expose errors to Telegram
        }),
      ),
      Logger.withMinimumLogLevel(LogLevel.Info),
    );

    await Effect.runPromise(program);

    // Always return 200 to Telegram
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Failed to process webhook:", error);
    // Return 200 anyway to prevent Telegram from retrying
    return new Response("OK", { status: 200 });
  }
}

/**
 * Handle webhook setup
 */
async function handleSetup(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { url: string };

    if (!body.url) {
      return new Response(
        JSON.stringify({ error: "Missing url parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const telegram = createTelegramClient(env.TELEGRAM_BOT_TOKEN);

    const result = await Effect.runPromise(
      telegram.setWebhook(body.url, {
        secret_token: env.WEBHOOK_SECRET,
      }),
    );

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Handle webhook info request
 */
async function handleWebhookInfo(env: Env): Promise<Response> {
  try {
    const telegram = createTelegramClient(env.TELEGRAM_BOT_TOKEN);
    const result = await Effect.runPromise(telegram.getWebhookInfo());

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
