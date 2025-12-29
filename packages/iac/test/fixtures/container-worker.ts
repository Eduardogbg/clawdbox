/**
 * Test worker that uses a Container binding.
 *
 * This demonstrates how to spawn and communicate with a Container
 * from a Cloudflare Worker.
 *
 * Note: In actual deployment, you would import { Container } from "@cloudflare/containers"
 * and extend it. This is a simplified test fixture since @cloudflare/containers
 * types need to be installed in the actual deployment project.
 */

export interface Env {
  TEST_CONTAINER: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Spawn container and proxy request
    if (url.pathname.startsWith("/container")) {
      try {
        const id = env.TEST_CONTAINER.idFromName("test");
        const stub = env.TEST_CONTAINER.get(id);

        // Create a new request to the container
        const containerUrl = new URL(request.url);
        containerUrl.pathname = containerUrl.pathname.replace("/container", "");

        const containerRequest = new Request(containerUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
        });

        return stub.fetch(containerRequest);
      } catch (error) {
        return new Response(JSON.stringify({
          error: "Container error",
          message: String(error)
        }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Container test worker", {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
