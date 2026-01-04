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

const badRequest = (message: string) =>
  new Response(JSON.stringify({ error: message }), { status: 400, headers: jsonHeaders });

const buildEnvDebug = (env: Env) => ({
  hasTelegramToken: Boolean(env.TELEGRAM_BOT_TOKEN),
  hasTelegramSecret: Boolean(env.TELEGRAM_SECRET_TOKEN),
  hasCodexApiKey: Boolean(env.CODEX_API_KEY),
  hasOpenaiApiKey: Boolean(env.OPENAI_API_KEY),
  hasCodexArgs: Boolean(env.CODEX_ARGS),
  hasCodexProfile: Boolean(env.CODEX_PROFILE),
  hasContainerWorkdir: Boolean(env.CONTAINER_WORKDIR),
  hasContainerRepoUrl: Boolean(env.CONTAINER_REPO_URL),
  hasContainerRepoBranch: Boolean(env.CONTAINER_REPO_BRANCH),
});

const getChatIdParam = (url: URL): string | null => {
  const raw = url.searchParams.get("chat_id");
  return raw && raw.trim().length > 0 ? raw.trim() : null;
};

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

    if (request.method === "GET" && url.pathname === "/debug/env") {
      return ok(buildEnvDebug(env));
    }

    if (request.method === "GET" && url.pathname === "/debug/orchestrator") {
      const chatId = getChatIdParam(url);
      if (!chatId) return badRequest("chat_id is required");
      const orchestrator = env.ORCHESTRATOR.get(env.ORCHESTRATOR.idFromName(chatId));
      return orchestrator.fetch("https://orchestrator/debug");
    }

    if (request.method === "POST" && url.pathname === "/debug/orchestrator/reset") {
      const chatId = getChatIdParam(url);
      if (!chatId) return badRequest("chat_id is required");
      const orchestrator = env.ORCHESTRATOR.get(env.ORCHESTRATOR.idFromName(chatId));
      return orchestrator.fetch("https://orchestrator/debug/reset", { method: "POST" });
    }

    if (request.method === "GET" && url.pathname === "/debug/container") {
      const chatId = getChatIdParam(url);
      if (!chatId) return badRequest("chat_id is required");
      const container = env.AGENT_CONTAINER.get(env.AGENT_CONTAINER.idFromName(chatId));
      const [statusResponse, healthResponse] = await Promise.all([
        container.fetch("https://container/status"),
        container.fetch("https://container/health"),
      ]);
      const status = statusResponse.ok ? await statusResponse.json() : null;
      const health = healthResponse.ok ? await healthResponse.json() : null;
      return ok({ status, health });
    }

    if (request.method === "GET" && url.pathname === "/debug/container/env") {
      const chatId = getChatIdParam(url);
      if (!chatId) return badRequest("chat_id is required");
      const container = env.AGENT_CONTAINER.get(env.AGENT_CONTAINER.idFromName(chatId));
      return container.fetch("https://container/debug/env");
    }

    if (request.method === "POST" && url.pathname === "/debug/container/stop") {
      const chatId = getChatIdParam(url);
      if (!chatId) return badRequest("chat_id is required");
      const container = env.AGENT_CONTAINER.get(env.AGENT_CONTAINER.idFromName(chatId));
      return container.fetch("https://container/stop", { method: "POST" });
    }

    if (request.method === "GET" && url.pathname === "/debug/container/ping") {
      const chatId = getChatIdParam(url);
      if (!chatId) return badRequest("chat_id is required");
      const container = env.AGENT_CONTAINER.get(env.AGENT_CONTAINER.idFromName(chatId));
      return container.fetch("https://container/ping");
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
