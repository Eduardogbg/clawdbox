/**
 * Agent Worker Entry Point
 *
 * Hosts the Telegram webhook handler and the Durable Objects that orchestrate
 * Codex runs inside Cloudflare Containers.
 */
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import { AgentContainerDO } from "./agent-container-do.js";
import { OrchestratorDO } from "./orchestrator-do.js";
import { decodeTelegramUpdate, getTelegramChatId } from "./telegram.js";
import type { Env } from "./types.js";

export { AgentContainerDO, OrchestratorDO };

const jsonHeaders = { "Content-Type": "application/json" };

const ok = (payload: unknown) =>
  new Response(JSON.stringify(payload), { headers: jsonHeaders });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return ok({
        name: "clawdbox-agent-worker",
        version: "0.1.0",
        status: "ok",
      });
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      if (
        env.TELEGRAM_SECRET_TOKEN &&
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_SECRET_TOKEN
      ) {
        return new Response("unauthorized", { status: 401 });
      }

      const rawUpdate = (await request.json()) as unknown;
      let update;
      try {
        update = await pipe(decodeTelegramUpdate(rawUpdate), Effect.runPromise);
      } catch (error) {
        console.error("Invalid Telegram update:", error);
        return ok({ status: "ignored" });
      }
      const chatId = getTelegramChatId(update);
      if (!chatId) {
        return ok({ status: "ignored" });
      }

      const orchestratorId = env.ORCHESTRATOR.idFromName(String(chatId));
      const orchestrator = env.ORCHESTRATOR.get(orchestratorId);
      ctx.waitUntil(
        orchestrator.fetch("https://orchestrator/handle", {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(update),
        }),
      );

      return ok({ status: "accepted" });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  },
};
