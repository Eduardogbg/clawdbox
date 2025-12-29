/**
 * Tests for AgentContainerDO
 *
 * These tests verify the HTTP endpoint handling and state management
 * of the Agent Container Durable Object.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "bun:test";
import type { ContainerState, ContainerStatus, AgentConfig } from "../src/types.js";

/**
 * Mock implementation of AgentContainerDO for testing.
 * We don't import the real class because it extends Cloudflare's Container
 * which isn't available in Node/Bun test environment.
 */
class MockAgentContainerDO {
  private initialized = false;
  private state: ContainerState = {
    status: "idle",
    taskId: null,
    config: null,
    startedAt: null,
    stoppedAt: null,
    error: null,
  };

  // Mock container control
  startContainer: Mock = vi.fn().mockResolvedValue(undefined);
  stopContainer: Mock = vi.fn().mockResolvedValue(undefined);
  envVars: Record<string, string> = {};

  async ensureInitialized(): Promise<void> {
    this.initialized = true;
  }

  getState(): ContainerState {
    return { ...this.state };
  }

  setState(update: Partial<ContainerState>): void {
    this.state = { ...this.state, ...update };
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();

    const url = new URL(request.url);
    const method = request.method;

    try {
      if (url.pathname === "/status" && method === "GET") {
        return this.handleStatus();
      }

      if (url.pathname === "/start" && method === "POST") {
        return this.handleStart(request);
      }

      if (url.pathname === "/stop" && method === "POST") {
        return this.handleStop();
      }

      if (url.pathname === "/health" && method === "GET") {
        return this.handleHealth();
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  private handleStatus(): Response {
    return new Response(JSON.stringify(this.getState()), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleStart(request: Request): Promise<Response> {
    const state = this.getState();

    if (state.status === "running" || state.status === "starting") {
      return new Response(
        JSON.stringify({
          error: "Container already running",
          taskId: state.taskId,
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const config: AgentConfig = await request.json();

    if (!config.taskId || !config.repoUrl || !config.prompt || !config.operatorUrl) {
      return new Response(
        JSON.stringify({
          error: "Missing required config: taskId, repoUrl, prompt, operatorUrl",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    this.setState({
      status: "starting",
      taskId: config.taskId,
      config,
      startedAt: Date.now(),
      stoppedAt: null,
      error: null,
    });

    try {
      this.envVars = {
        AGENT_CONFIG: JSON.stringify(config),
      };

      await this.startContainer();

      this.setState({ status: "running" });

      return new Response(
        JSON.stringify({
          status: "started",
          taskId: config.taskId,
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      this.setState({
        status: "error",
        error: error instanceof Error ? error.message : "Failed to start",
        stoppedAt: Date.now(),
      });

      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to start container",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  private async handleStop(): Promise<Response> {
    const state = this.getState();

    if (state.status !== "running" && state.status !== "starting") {
      return new Response(
        JSON.stringify({
          status: "already stopped",
          previousStatus: state.status,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    this.setState({ status: "stopping" });

    try {
      await this.stopContainer();

      this.setState({
        status: "stopped",
        stoppedAt: Date.now(),
      });

      return new Response(
        JSON.stringify({
          status: "stopped",
          taskId: state.taskId,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      this.setState({
        status: "error",
        error: error instanceof Error ? error.message : "Failed to stop",
        stoppedAt: Date.now(),
      });

      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Failed to stop container",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  private handleHealth(): Response {
    const state = this.getState();

    const health = {
      do: "healthy",
      container: state.status,
      taskId: state.taskId,
      startedAt: state.startedAt,
    };

    return new Response(JSON.stringify(health), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Lifecycle callbacks
  onStart(): void {
    this.setState({ status: "running" });
  }

  async onStop(params: { exitCode: number }): Promise<void> {
    if (params.exitCode === 0) {
      this.setState({
        status: "stopped",
        stoppedAt: Date.now(),
      });
    } else {
      this.setState({
        status: "error",
        error: `Container exited with code ${params.exitCode}`,
        stoppedAt: Date.now(),
      });
    }
  }

  onError(error: unknown): void {
    this.setState({
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
      stoppedAt: Date.now(),
    });
  }
}

describe("AgentContainerDO", () => {
  let containerDO: MockAgentContainerDO;

  beforeEach(() => {
    containerDO = new MockAgentContainerDO();
  });

  describe("Status endpoint", () => {
    it("should return initial idle status", async () => {
      const request = new Request("http://localhost/status", { method: "GET" });
      const response = await containerDO.fetch(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe("idle");
      expect(body.taskId).toBeNull();
      expect(body.config).toBeNull();
    });
  });

  describe("Health endpoint", () => {
    it("should return DO health with container status", async () => {
      const request = new Request("http://localhost/health", { method: "GET" });
      const response = await containerDO.fetch(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.do).toBe("healthy");
      expect(body.container).toBe("idle");
      expect(body.taskId).toBeNull();
    });

    it("should reflect running status after start", async () => {
      const config: AgentConfig = {
        taskId: "test-task",
        repoUrl: "https://github.com/test/repo",
        prompt: "Test prompt",
        operatorUrl: "https://operator.example.com",
        branch: "main",
      };

      const startRequest = new Request("http://localhost/start", {
        method: "POST",
        body: JSON.stringify(config),
        headers: { "Content-Type": "application/json" },
      });
      await containerDO.fetch(startRequest);

      const healthRequest = new Request("http://localhost/health", { method: "GET" });
      const response = await containerDO.fetch(healthRequest);
      const body = await response.json();

      expect(body.container).toBe("running");
      expect(body.taskId).toBe("test-task");
    });
  });

  describe("Start endpoint", () => {
    const validConfig: AgentConfig = {
      taskId: "test-task-123",
      repoUrl: "https://github.com/test/repo",
      prompt: "Implement feature X",
      operatorUrl: "https://operator.example.com",
      branch: "main",
    };

    it("should start container with valid config", async () => {
      const request = new Request("http://localhost/start", {
        method: "POST",
        body: JSON.stringify(validConfig),
        headers: { "Content-Type": "application/json" },
      });

      const response = await containerDO.fetch(request);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.status).toBe("started");
      expect(body.taskId).toBe("test-task-123");
      expect(containerDO.startContainer).toHaveBeenCalled();
    });

    it("should set AGENT_CONFIG environment variable", async () => {
      const request = new Request("http://localhost/start", {
        method: "POST",
        body: JSON.stringify(validConfig),
        headers: { "Content-Type": "application/json" },
      });

      await containerDO.fetch(request);

      expect(containerDO.envVars.AGENT_CONFIG).toBeDefined();
      const parsedConfig = JSON.parse(containerDO.envVars.AGENT_CONFIG);
      expect(parsedConfig.taskId).toBe("test-task-123");
      expect(parsedConfig.repoUrl).toBe("https://github.com/test/repo");
    });

    it("should reject missing taskId", async () => {
      const invalidConfig = { ...validConfig };
      delete (invalidConfig as Partial<AgentConfig>).taskId;

      const request = new Request("http://localhost/start", {
        method: "POST",
        body: JSON.stringify(invalidConfig),
        headers: { "Content-Type": "application/json" },
      });

      const response = await containerDO.fetch(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain("Missing required config");
    });

    it("should reject missing repoUrl", async () => {
      const invalidConfig = { ...validConfig };
      delete (invalidConfig as Partial<AgentConfig>).repoUrl;

      const request = new Request("http://localhost/start", {
        method: "POST",
        body: JSON.stringify(invalidConfig),
        headers: { "Content-Type": "application/json" },
      });

      const response = await containerDO.fetch(request);
      expect(response.status).toBe(400);
    });

    it("should reject start when already running", async () => {
      // First start
      const request1 = new Request("http://localhost/start", {
        method: "POST",
        body: JSON.stringify(validConfig),
        headers: { "Content-Type": "application/json" },
      });
      await containerDO.fetch(request1);

      // Second start attempt
      const request2 = new Request("http://localhost/start", {
        method: "POST",
        body: JSON.stringify({ ...validConfig, taskId: "another-task" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await containerDO.fetch(request2);
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toBe("Container already running");
      expect(body.taskId).toBe("test-task-123");
    });

    it("should handle start failure", async () => {
      containerDO.startContainer.mockRejectedValue(new Error("Container start failed"));

      const request = new Request("http://localhost/start", {
        method: "POST",
        body: JSON.stringify(validConfig),
        headers: { "Content-Type": "application/json" },
      });

      const response = await containerDO.fetch(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Container start failed");

      const state = containerDO.getState();
      expect(state.status).toBe("error");
      expect(state.error).toBe("Container start failed");
    });
  });

  describe("Stop endpoint", () => {
    const config: AgentConfig = {
      taskId: "test-task",
      repoUrl: "https://github.com/test/repo",
      prompt: "Test prompt",
      operatorUrl: "https://operator.example.com",
      branch: "main",
    };

    it("should stop running container", async () => {
      // First start
      const startRequest = new Request("http://localhost/start", {
        method: "POST",
        body: JSON.stringify(config),
        headers: { "Content-Type": "application/json" },
      });
      await containerDO.fetch(startRequest);

      // Then stop
      const stopRequest = new Request("http://localhost/stop", { method: "POST" });
      const response = await containerDO.fetch(stopRequest);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe("stopped");
      expect(body.taskId).toBe("test-task");
      expect(containerDO.stopContainer).toHaveBeenCalled();
    });

    it("should return already stopped for idle container", async () => {
      const request = new Request("http://localhost/stop", { method: "POST" });
      const response = await containerDO.fetch(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe("already stopped");
      expect(body.previousStatus).toBe("idle");
    });

    it("should handle stop failure", async () => {
      // Start container first
      const startRequest = new Request("http://localhost/start", {
        method: "POST",
        body: JSON.stringify(config),
        headers: { "Content-Type": "application/json" },
      });
      await containerDO.fetch(startRequest);

      // Mock stop failure
      containerDO.stopContainer.mockRejectedValue(new Error("Stop failed"));

      const stopRequest = new Request("http://localhost/stop", { method: "POST" });
      const response = await containerDO.fetch(stopRequest);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Stop failed");
    });
  });

  describe("Not found handler", () => {
    it("should return 404 for unknown path", async () => {
      const request = new Request("http://localhost/unknown", { method: "GET" });
      const response = await containerDO.fetch(request);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe("Not found");
    });
  });

  describe("Lifecycle callbacks", () => {
    it("onStart should set status to running", () => {
      containerDO.setState({ status: "starting", taskId: "test" });
      containerDO.onStart();

      expect(containerDO.getState().status).toBe("running");
    });

    it("onStop with exit code 0 should set status to stopped", async () => {
      containerDO.setState({ status: "running", taskId: "test" });
      await containerDO.onStop({ exitCode: 0 });

      const state = containerDO.getState();
      expect(state.status).toBe("stopped");
      expect(state.stoppedAt).toBeDefined();
    });

    it("onStop with non-zero exit code should set status to error", async () => {
      containerDO.setState({ status: "running", taskId: "test" });
      await containerDO.onStop({ exitCode: 1 });

      const state = containerDO.getState();
      expect(state.status).toBe("error");
      expect(state.error).toContain("exited with code 1");
    });

    it("onError should set status to error", () => {
      containerDO.setState({ status: "running", taskId: "test" });
      containerDO.onError(new Error("Something went wrong"));

      const state = containerDO.getState();
      expect(state.status).toBe("error");
      expect(state.error).toBe("Something went wrong");
    });
  });

  describe("State management", () => {
    it("should preserve config in state", async () => {
      const config: AgentConfig = {
        taskId: "test-task",
        repoUrl: "https://github.com/test/repo",
        prompt: "Test prompt",
        operatorUrl: "https://operator.example.com",
        branch: "feature-branch",
        sessionId: "resume-session-123",
      };

      const request = new Request("http://localhost/start", {
        method: "POST",
        body: JSON.stringify(config),
        headers: { "Content-Type": "application/json" },
      });

      await containerDO.fetch(request);

      const state = containerDO.getState();
      expect(state.config).toEqual(config);
      expect(state.config?.branch).toBe("feature-branch");
      expect(state.config?.sessionId).toBe("resume-session-123");
    });
  });
});
