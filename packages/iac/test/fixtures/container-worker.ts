/**
 * Test worker that uses a Container binding.
 *
 * This demonstrates how to spawn and communicate with a Container
 * from a Cloudflare Worker.
 */
import { Container } from "@cloudflare/containers";

export interface Env {
  TEST_CONTAINER: DurableObjectNamespace<TestContainer>;
}

/**
 * Simple test container that echoes requests
 */
export class TestContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10s";

  override onStart(): void {
    console.log("TestContainer started");
  }

  override onStop(): void {
    console.log("TestContainer stopped");
  }

  override onError(error: unknown): void {
    console.error("TestContainer error:", error);
  }
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
