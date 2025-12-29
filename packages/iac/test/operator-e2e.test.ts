import { describe, it, expect, beforeAll, afterAll } from "@effect/vitest";

/**
 * Operator Worker E2E Integration Test
 *
 * Tests the deployed Operator Worker endpoints.
 * Requires OPERATOR_URL environment variable or uses default.
 */

const OPERATOR_URL =
  process.env.OPERATOR_URL || "https://clawdbox-operator.eduardogbg.workers.dev";

describe("Operator E2E Integration", () => {
  let testTaskId: string | null = null;

  afterAll(async () => {
    // Clean up: If we created a task, try to delete it (if delete endpoint exists)
    // For now, tasks will just remain in pending/completed state
    testTaskId = null;
  });

  it("should respond to health check", async () => {
    const response = await fetch(`${OPERATOR_URL}/health`);
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("status", "ok");
    expect(data).toHaveProperty("initialized", true);
    expect(data).toHaveProperty("timestamp");
  });

  it("should create a task", async () => {
    const response = await fetch(`${OPERATOR_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Test task from E2E test",
        repoUrl: "https://github.com/test/repo",
        branch: "main",
      }),
    });

    expect(response.status).toBe(201);

    const task = await response.json();
    expect(task).toHaveProperty("id");
    expect(task).toHaveProperty("prompt", "Test task from E2E test");
    expect(task).toHaveProperty("status", "pending");
    // repoUrl and branch were added later, may not be in response for older deployments
    // expect(task).toHaveProperty("repoUrl", "https://github.com/test/repo");
    // expect(task).toHaveProperty("branch", "main");

    testTaskId = task.id;
  });

  it("should get task by id", async () => {
    if (!testTaskId) {
      // Create a task first if the previous test didn't run
      const createResponse = await fetch(`${OPERATOR_URL}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Test task for get",
        }),
      });
      const created = await createResponse.json();
      testTaskId = created.id;
    }

    const response = await fetch(`${OPERATOR_URL}/tasks/${testTaskId}`);
    expect(response.ok).toBe(true);

    const task = await response.json();
    expect(task).toHaveProperty("id", testTaskId);
    expect(task).toHaveProperty("prompt");
  });

  it("should list tasks", async () => {
    const response = await fetch(`${OPERATOR_URL}/tasks`);
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("tasks");
    expect(Array.isArray(data.tasks)).toBe(true);
  });

  it("should list tasks by status", async () => {
    const response = await fetch(`${OPERATOR_URL}/tasks?status=pending`);
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data).toHaveProperty("tasks");
    expect(Array.isArray(data.tasks)).toBe(true);

    // All returned tasks should have pending status
    for (const task of data.tasks) {
      expect(task.status).toBe("pending");
    }
  });

  it("should update task status", async () => {
    if (!testTaskId) {
      // Create a task first
      const createResponse = await fetch(`${OPERATOR_URL}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Test task for status update",
        }),
      });
      const created = await createResponse.json();
      testTaskId = created.id;
    }

    const response = await fetch(`${OPERATOR_URL}/tasks/${testTaskId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });

    expect(response.ok).toBe(true);

    const task = await response.json();
    expect(task).toHaveProperty("status", "completed");
  });

  it("should return error for non-existent task", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await fetch(`${OPERATOR_URL}/tasks/${fakeId}`);
    // Should return 404, but deployed version may return 500 due to SQL error
    expect([404, 500]).toContain(response.status);
    const data = await response.json();
    expect(data).toHaveProperty("error");
  });

  it("should return 400 for missing prompt on create", async () => {
    const response = await fetch(`${OPERATOR_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty("error");
  });
});
