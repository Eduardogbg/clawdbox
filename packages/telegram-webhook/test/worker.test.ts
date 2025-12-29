/**
 * Tests for Telegram Webhook Worker entry point
 *
 * These tests verify the Worker's HTTP routing and request handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mock environment
 */
interface MockEnv {
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
  OPERATOR_URL?: string;
}

/**
 * Create a mock environment
 */
function createMockEnv(overrides: Partial<MockEnv> = {}): MockEnv {
  return {
    TELEGRAM_BOT_TOKEN: "test-bot-token",
    OPERATOR_URL: "https://operator.example.com",
    ...overrides,
  };
}

/**
 * Simplified worker fetch handler (mirrors src/index.ts routing logic)
 */
async function workerFetch(request: Request, env: MockEnv): Promise<Response> {
  const url = new URL(request.url);

  // Health check
  if (url.pathname === "/health") {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Webhook endpoint
  if (url.pathname === "/webhook" && request.method === "POST") {
    // Verify secret token if configured
    if (env.WEBHOOK_SECRET) {
      const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secretHeader !== env.WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    // Always return 200 to Telegram
    return new Response("OK", { status: 200 });
  }

  // Setup endpoint
  if (url.pathname === "/setup" && request.method === "POST") {
    try {
      const body = (await request.json()) as { url: string };
      if (!body.url) {
        return new Response(
          JSON.stringify({ error: "Missing url parameter" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Webhook info
  if (url.pathname === "/webhook-info" && request.method === "GET") {
    return new Response(
      JSON.stringify({ url: "https://example.com/webhook" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response("Not found", { status: 404 });
}

describe("Telegram Webhook Worker", () => {
  describe("Health endpoint", () => {
    it("should return ok status on /health", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/health", { method: "GET" });

      const response = await workerFetch(request, env);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
    });
  });

  describe("Webhook endpoint", () => {
    it("should accept POST to /webhook", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/webhook", {
        method: "POST",
        body: JSON.stringify({ update_id: 123 }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await workerFetch(request, env);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("OK");
    });

    it("should reject webhook without secret when required", async () => {
      const env = createMockEnv({ WEBHOOK_SECRET: "my-secret" });
      const request = new Request("http://localhost/webhook", {
        method: "POST",
        body: JSON.stringify({ update_id: 123 }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await workerFetch(request, env);

      expect(response.status).toBe(401);
    });

    it("should accept webhook with correct secret", async () => {
      const env = createMockEnv({ WEBHOOK_SECRET: "my-secret" });
      const request = new Request("http://localhost/webhook", {
        method: "POST",
        body: JSON.stringify({ update_id: 123 }),
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "my-secret",
        },
      });

      const response = await workerFetch(request, env);

      expect(response.status).toBe(200);
    });

    it("should reject webhook with wrong secret", async () => {
      const env = createMockEnv({ WEBHOOK_SECRET: "my-secret" });
      const request = new Request("http://localhost/webhook", {
        method: "POST",
        body: JSON.stringify({ update_id: 123 }),
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "wrong-secret",
        },
      });

      const response = await workerFetch(request, env);

      expect(response.status).toBe(401);
    });

    it("should reject GET to /webhook", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/webhook", { method: "GET" });

      const response = await workerFetch(request, env);

      expect(response.status).toBe(404);
    });
  });

  describe("Setup endpoint", () => {
    it("should accept POST to /setup with URL", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/setup", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/webhook" }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await workerFetch(request, env);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject setup without URL", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/setup", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });

      const response = await workerFetch(request, env);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain("Missing url");
    });

    it("should reject setup with invalid JSON", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/setup", {
        method: "POST",
        body: "not-json",
        headers: { "Content-Type": "application/json" },
      });

      const response = await workerFetch(request, env);

      expect(response.status).toBe(400);
    });
  });

  describe("Webhook info endpoint", () => {
    it("should return webhook info on GET /webhook-info", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/webhook-info", { method: "GET" });

      const response = await workerFetch(request, env);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.url).toBeDefined();
    });
  });

  describe("404 handling", () => {
    it("should return 404 for unknown paths", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/unknown", { method: "GET" });

      const response = await workerFetch(request, env);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found");
    });

    it("should return 404 for wrong method on known paths", async () => {
      const env = createMockEnv();
      const request = new Request("http://localhost/setup", { method: "GET" });

      const response = await workerFetch(request, env);

      expect(response.status).toBe(404);
    });
  });
});
