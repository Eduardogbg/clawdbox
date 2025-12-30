/**
 * Takopi Worker Entry Point
 */
import { TakopiContainerDO } from "./takopi-container-do.js";
import type { Env } from "./types.js";

export { TakopiContainerDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          name: "clawdbox-takopi-worker",
          version: "0.0.1",
          status: "ok",
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const instanceMatch = url.pathname.match(/^\/takopi\/([^/]+)/);
    if (instanceMatch) {
      const instanceId = instanceMatch[1];
      const containerId = env.TAKOPI_CONTAINER.idFromName(instanceId);
      const container = env.TAKOPI_CONTAINER.get(containerId);

      const newPath = url.pathname.replace(/^\/takopi\/[^/]+/, "") || "/";
      const newUrl = new URL(newPath + url.search, url.origin);

      return container.fetch(
        new Request(newUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
        }),
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
};
