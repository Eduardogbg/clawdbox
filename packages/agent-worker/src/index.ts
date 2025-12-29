/**
 * Agent Worker Entry Point
 *
 * This Worker hosts the AgentContainerDO that controls Claude agent containers.
 * It provides an HTTP interface for the Operator to spawn and manage agents.
 */
import { AgentContainerDO } from "./agent-container-do.js";
import type { Env } from "./types.js";

// Re-export the Container DO class for Cloudflare
export { AgentContainerDO };

/**
 * Worker fetch handler - routes requests to container instances
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check at worker level
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          name: "clawdbox-agent-worker",
          version: "0.0.1",
          status: "ok",
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Route /agent/:id/* to specific container instance
    const agentMatch = url.pathname.match(/^\/agent\/([^/]+)/);
    if (agentMatch) {
      const agentId = agentMatch[1];
      const containerId = env.AGENT_CONTAINER.idFromName(agentId);
      const container = env.AGENT_CONTAINER.get(containerId);

      // Forward the request, stripping the /agent/:id prefix
      const newPath = url.pathname.replace(/^\/agent\/[^/]+/, "") || "/";
      const newUrl = new URL(newPath + url.search, url.origin);

      return container.fetch(new Request(newUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      }));
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
};
