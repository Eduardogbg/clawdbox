import { describe, expect, it, vi } from "bun:test";
import worker from "../src/index.js";
import type { Env } from "../src/types.js";

const makeExecutionContext = () =>
  ({
    waitUntil: vi.fn(),
  }) as unknown as ExecutionContext;

const makeEnv = (overrides?: Partial<Env>): Env => {
  const orchestratorStub = {
    fetch: vi.fn().mockResolvedValue(new Response("ok")),
  };

  return {
    TELEGRAM_BOT_TOKEN: "token",
    ORCHESTRATOR: {
      idFromName: vi.fn().mockReturnValue({ toString: () => "mock-id" }),
      get: vi.fn().mockReturnValue(orchestratorStub),
    } as unknown as DurableObjectNamespace,
    AGENT_CONTAINER: {
      idFromName: vi.fn(),
      get: vi.fn(),
    } as unknown as DurableObjectNamespace,
    ...overrides,
  };
};

describe("agent-worker", () => {
  it("returns health payload", async () => {
    const env = makeEnv();
    const request = new Request("http://localhost/health", { method: "GET" });
    const response = await worker.fetch(request, env, makeExecutionContext());
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.name).toBe("clawdbox-agent-worker");
  });

  it("forwards webhook to orchestrator DO", async () => {
    const env = makeEnv();
    const ctx = makeExecutionContext();
    const update = {
      update_id: 1,
      message: {
        message_id: 10,
        text: "hello",
        chat: { id: 123 },
      },
    };
    const request = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });

    const response = await worker.fetch(request, env, ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("accepted");
    expect(env.ORCHESTRATOR.idFromName).toHaveBeenCalledWith("123");
    expect(env.ORCHESTRATOR.get).toHaveBeenCalled();
    expect(ctx.waitUntil).toHaveBeenCalled();
  });

  it("rejects webhook without secret token", async () => {
    const env = makeEnv({ TELEGRAM_SECRET_TOKEN: "secret" });
    const request = new Request("http://localhost/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    });

    const response = await worker.fetch(request, env, makeExecutionContext());
    expect(response.status).toBe(401);
  });
});
