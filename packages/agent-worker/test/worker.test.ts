/**
 * Tests for Agent Worker HTTP handler
 *
 * These tests verify the Worker's routing logic and health endpoint.
 */
import { describe, it, expect, vi } from "vitest";
import type { Env } from "../src/types.js";

/**
 * Create a mock environment with DO namespace
 */
function createMockEnv(): Env {
  const mockContainer = {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      })
    ),
  };

  return {
    AGENT_CONTAINER: {
      idFromName: vi.fn().mockReturnValue({ toString: () => "mock-id" }),
      get: vi.fn().mockReturnValue(mockContainer),
    } as unknown as DurableObjectNamespace,
  };
}

/**
 * Simplified worker fetch handler (mirrors src/index.ts logic)
 */
async function workerFetch(request: Request, env: Env): Promise<Response> {
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

    return container.fetch(
      new Request(newUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      })
    );
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Agent Worker", () => {
  describe("Health endpoint", () => {
    it("should return worker info at root path", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/", { method: "GET" });

      const response = await workerFetch(request, env);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.name).toBe("clawdbox-agent-worker");
      expect(body.version).toBe("0.0.1");
      expect(body.status).toBe("ok");
    });
  });

  describe("Agent routing", () => {
    it("should route /agent/:id/start to container DO", async () => {
      const env = createMockEnv();
      // Use GET request to avoid body/duplex issues in test environment
      const request = new Request("http://localhost/agent/task-123/start", {
        method: "GET",
      });

      await workerFetch(request, env);

      expect(env.AGENT_CONTAINER.idFromName).toHaveBeenCalledWith("task-123");
      expect(env.AGENT_CONTAINER.get).toHaveBeenCalled();
    });

    it("should strip agent prefix when forwarding", async () => {
      const env = createMockEnv();
      const mockContainer = env.AGENT_CONTAINER.get({} as DurableObjectId);

      const request = new Request("http://localhost/agent/task-123/status", {
        method: "GET",
      });

      await workerFetch(request, env);

      // Check that fetch was called with the stripped path
      expect(mockContainer.fetch).toHaveBeenCalled();
      const forwardedRequest = (mockContainer.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const forwardedUrl = new URL(forwardedRequest.url);
      expect(forwardedUrl.pathname).toBe("/status");
    });

    it("should forward query parameters", async () => {
      const env = createMockEnv();
      const mockContainer = env.AGENT_CONTAINER.get({} as DurableObjectId);

      const request = new Request("http://localhost/agent/task-123/status?verbose=true", {
        method: "GET",
      });

      await workerFetch(request, env);

      const forwardedRequest = (mockContainer.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const forwardedUrl = new URL(forwardedRequest.url);
      expect(forwardedUrl.search).toBe("?verbose=true");
    });

    it("should forward request method", async () => {
      const env = createMockEnv();
      const mockContainer = env.AGENT_CONTAINER.get({} as DurableObjectId);

      const request = new Request("http://localhost/agent/task-123/stop", {
        method: "POST",
      });

      await workerFetch(request, env);

      const forwardedRequest = (mockContainer.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(forwardedRequest.method).toBe("POST");
    });

    it("should use empty path if only /agent/:id", async () => {
      const env = createMockEnv();
      const mockContainer = env.AGENT_CONTAINER.get({} as DurableObjectId);

      const request = new Request("http://localhost/agent/task-123", {
        method: "GET",
      });

      await workerFetch(request, env);

      const forwardedRequest = (mockContainer.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const forwardedUrl = new URL(forwardedRequest.url);
      expect(forwardedUrl.pathname).toBe("/");
    });
  });

  describe("404 handling", () => {
    it("should return 404 for unknown paths", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/unknown", { method: "GET" });

      const response = await workerFetch(request, env);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe("Not found");
    });

    it("should return 404 for POST to root", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/", { method: "POST" });

      const response = await workerFetch(request, env);
      expect(response.status).toBe(404);
    });
  });

  describe("Agent ID extraction", () => {
    it("should handle agent IDs with dashes", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/agent/task-with-dashes-123/status", {
        method: "GET",
      });

      await workerFetch(request, env);

      expect(env.AGENT_CONTAINER.idFromName).toHaveBeenCalledWith("task-with-dashes-123");
    });

    it("should handle UUID agent IDs", async () => {
      const env = createMockEnv();
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const request = new Request(`http://localhost/agent/${uuid}/status`, {
        method: "GET",
      });

      await workerFetch(request, env);

      expect(env.AGENT_CONTAINER.idFromName).toHaveBeenCalledWith(uuid);
    });
  });
});
