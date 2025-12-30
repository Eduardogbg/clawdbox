/**
 * Tests for Takopi Worker HTTP handler
 */
import { describe, it, expect, vi } from "bun:test";
import type { Env } from "../src/types.js";

function createMockEnv(): Env {
  const mockContainer = {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      }),
    ),
  };

  return {
    TAKOPI_CONTAINER: {
      idFromName: vi.fn().mockReturnValue({ toString: () => "mock-id" }),
      get: vi.fn().mockReturnValue(mockContainer),
    } as unknown as DurableObjectNamespace,
  };
}

async function workerFetch(request: Request, env: Env): Promise<Response> {
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
}

describe("Takopi Worker", () => {
  it("should return worker info at root", async () => {
    const env = createMockEnv();
    const request = new Request("http://localhost/", { method: "GET" });

    const response = await workerFetch(request, env);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe("clawdbox-takopi-worker");
    expect(body.status).toBe("ok");
  });

  it("should route /takopi/:id/start to container DO", async () => {
    const env = createMockEnv();
    const request = new Request("http://localhost/takopi/bot-1/start", {
      method: "GET",
    });

    await workerFetch(request, env);

    expect(env.TAKOPI_CONTAINER.idFromName).toHaveBeenCalledWith("bot-1");
    expect(env.TAKOPI_CONTAINER.get).toHaveBeenCalled();
  });

  it("should strip takopi prefix when forwarding", async () => {
    const env = createMockEnv();
    const mockContainer = env.TAKOPI_CONTAINER.get({} as DurableObjectId);

    const request = new Request("http://localhost/takopi/bot-1/status", {
      method: "GET",
    });

    await workerFetch(request, env);

    expect(mockContainer.fetch).toHaveBeenCalled();
    const forwardedRequest = (mockContainer.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const forwardedUrl = new URL(forwardedRequest.url);
    expect(forwardedUrl.pathname).toBe("/status");
  });

  it("should return 404 for unknown paths", async () => {
    const env = createMockEnv();
    const request = new Request("http://localhost/unknown", { method: "GET" });

    const response = await workerFetch(request, env);
    expect(response.status).toBe(404);
  });
});
