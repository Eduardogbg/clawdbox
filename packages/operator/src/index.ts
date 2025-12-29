/**
 * Operator Worker Entry Point
 *
 * This Worker hosts the OperatorDO and routes requests to it.
 * The Operator manages agent orchestration, task state, and permission handling.
 */
import { OperatorDO, type Env } from "./operator-do.js";

// Re-export the Durable Object class for Cloudflare
export { OperatorDO };

/**
 * Worker fetch handler - routes all requests to the Operator DO
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check at worker level
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          name: "clawdbox-operator",
          version: "0.0.1",
          status: "ok",
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Route all other requests to the main Operator DO instance
    // We use a singleton pattern with a fixed name
    const operatorId = env.OPERATOR.idFromName("main");
    const operator = env.OPERATOR.get(operatorId);

    // Forward the request to the DO
    return operator.fetch(request);
  },
};
