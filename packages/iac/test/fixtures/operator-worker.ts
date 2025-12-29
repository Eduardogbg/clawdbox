/**
 * Test fixture: Operator Worker with Durable Object
 *
 * This is a simplified version of the Operator for testing purposes.
 * It demonstrates deploying a Worker with a Durable Object binding.
 */
import { DurableObject } from "cloudflare:workers";

/**
 * Simple Operator Durable Object for testing
 */
export class TestOperatorDO extends DurableObject {
  private counter = 0;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", counter: this.counter }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/increment") {
      this.counter++;
      return new Response(JSON.stringify({ counter: this.counter }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}

interface Env {
  OPERATOR: DurableObjectNamespace<TestOperatorDO>;
}

/**
 * Worker entry point
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Root health check
    if (url.pathname === "/") {
      return new Response(JSON.stringify({
        name: "test-operator-worker",
        status: "ok"
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Route to Durable Object
    const operatorId = env.OPERATOR.idFromName("main");
    const operator = env.OPERATOR.get(operatorId);
    return operator.fetch(request);
  },
};
