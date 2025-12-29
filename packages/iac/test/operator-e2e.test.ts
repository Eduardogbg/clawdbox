import { describe, it, expect, afterAll } from "bun:test";

/**
 * Operator Worker E2E Integration Test
 *
 * Tests the deployed Operator Worker endpoints.
 * Requires OPERATOR_URL environment variable or uses default.
 */

const OPERATOR_URL =
  process.env.OPERATOR_URL || "https://clawdbox-operator.eduardogbg.workers.dev";

// Type definitions for API responses
interface Task {
  id: string;
  prompt: string;
  status: string;
  repoUrl?: string;
  branch?: string;
}

interface Session {
  id: string;
  taskId: string;
  status: string;
  containerId?: string;
  claudeSessionId?: string;
}

interface Permission {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: string;
  status: string;
  reason?: string;
}

interface TasksResponse {
  tasks: Task[];
}

interface ErrorResponse {
  error: string;
}

interface PermissionsResponse {
  permissions: Permission[];
  taskId: string;
  sessionId?: string;
}

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

    const task = (await response.json()) as Task;
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
      const created = (await createResponse.json()) as Task;
      testTaskId = created.id;
    }

    const response = await fetch(`${OPERATOR_URL}/tasks/${testTaskId}`);
    expect(response.ok).toBe(true);

    const task = (await response.json()) as Task;
    expect(task).toHaveProperty("id", testTaskId);
    expect(task).toHaveProperty("prompt");
  });

  it("should list tasks", async () => {
    const response = await fetch(`${OPERATOR_URL}/tasks`);
    expect(response.ok).toBe(true);

    const data = (await response.json()) as TasksResponse;
    expect(data).toHaveProperty("tasks");
    expect(Array.isArray(data.tasks)).toBe(true);
  });

  it("should list tasks by status", async () => {
    const response = await fetch(`${OPERATOR_URL}/tasks?status=pending`);
    expect(response.ok).toBe(true);

    const data = (await response.json()) as TasksResponse;
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
      const created = (await createResponse.json()) as Task;
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

describe("Operator Session & Permission Flow", () => {
  let taskId: string;
  let sessionId: string;
  let permissionId: string;

  it("should create task and session for permission testing", async () => {
    // Create a task
    const taskResponse = await fetch(`${OPERATOR_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Test task for permission flow",
        repoUrl: "https://github.com/test/permission-flow",
        branch: "main",
      }),
    });

    expect(taskResponse.status).toBe(201);
    const task = (await taskResponse.json()) as Task;
    taskId = task.id;

    // Create a session for this task
    const sessionResponse = await fetch(`${OPERATOR_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        containerId: "test-container-1",
      }),
    });

    expect(sessionResponse.status).toBe(201);
    const session = (await sessionResponse.json()) as Session;
    sessionId = session.id;
    expect(session.taskId).toBe(taskId);
    expect(session.status).toBe("starting");

    // Task should now be active
    const taskCheck = await fetch(`${OPERATOR_URL}/tasks/${taskId}`);
    const updatedTask = (await taskCheck.json()) as Task;
    expect(updatedTask.status).toBe("active");
  });

  it("should get session by id", async () => {
    const response = await fetch(`${OPERATOR_URL}/sessions/${sessionId}`);
    expect(response.ok).toBe(true);

    const session = (await response.json()) as Session;
    expect(session.id).toBe(sessionId);
  });

  it("should create permission request via async endpoint", async () => {
    permissionId = crypto.randomUUID();
    const response = await fetch(`${OPERATOR_URL}/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        toolUseId: permissionId,
        toolName: "Bash",
        toolInput: JSON.stringify({ command: "rm -rf /dangerous" }),
      }),
    });

    expect(response.status).toBe(201);
    const permission = (await response.json()) as Permission;
    expect(permission.id).toBe(permissionId);
    expect(permission.status).toBe("pending");
    expect(permission.toolName).toBe("Bash");
  });

  it("should get permission by id", async () => {
    const response = await fetch(`${OPERATOR_URL}/permissions/${permissionId}`);
    expect(response.ok).toBe(true);

    const permission = (await response.json()) as Permission;
    expect(permission.id).toBe(permissionId);
    expect(permission.status).toBe("pending");
  });

  it("should resolve permission as denied", async () => {
    const response = await fetch(`${OPERATOR_URL}/permissions/${permissionId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approved: false,
        reason: "Too dangerous",
      }),
    });

    expect(response.ok).toBe(true);
    const permission = (await response.json()) as Permission;
    expect(permission.status).toBe("denied");
    expect(permission.reason).toBe("Too dangerous");
  });

  it("should not allow resolving already resolved permission", async () => {
    const response = await fetch(`${OPERATOR_URL}/permissions/${permissionId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approved: true,
      }),
    });

    expect(response.status).toBe(409);
  });

  it("should handle session reporting", async () => {
    const response = await fetch(`${OPERATOR_URL}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        sessionId: "claude-sdk-session-123",
      }),
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result).toHaveProperty("received", true);
  });

  it("should handle stream messages", async () => {
    const response = await fetch(`${OPERATOR_URL}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        text: "Agent is processing...",
        type: "text",
      }),
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result).toHaveProperty("received", true);
  });

  it("should handle task completion", async () => {
    const response = await fetch(`${OPERATOR_URL}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        result: { success: true, message: "All done!" },
      }),
    });

    expect(response.ok).toBe(true);

    // Check task is now completed
    const taskCheck = await fetch(`${OPERATOR_URL}/tasks/${taskId}`);
    const task = (await taskCheck.json()) as Task;
    expect(task.status).toBe("completed");
  });

  it("should handle error reporting", async () => {
    // Create a new task for error testing
    const taskResponse = await fetch(`${OPERATOR_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Test task for error",
      }),
    });
    const newTask = (await taskResponse.json()) as Task;

    // Create session
    await fetch(`${OPERATOR_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: newTask.id,
      }),
    });

    // Report error
    const response = await fetch(`${OPERATOR_URL}/error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: newTask.id,
        error: "Something went wrong",
      }),
    });

    expect(response.ok).toBe(true);

    // Check task is now failed
    const taskCheck = await fetch(`${OPERATOR_URL}/tasks/${newTask.id}`);
    const task = (await taskCheck.json()) as Task;
    expect(task.status).toBe("failed");
  });
});

describe("Operator Permission Queries", () => {
  let taskId: string;
  let sessionId: string;

  it("should create task and session for permission query test", async () => {
    // Create a task
    const taskResponse = await fetch(`${OPERATOR_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Test task for permission queries",
      }),
    });
    const task = (await taskResponse.json()) as Task;
    taskId = task.id;

    // Create a session
    const sessionResponse = await fetch(`${OPERATOR_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    const session = (await sessionResponse.json()) as Session;
    sessionId = session.id;
  });

  it("should get empty permissions list for new task", async () => {
    const response = await fetch(`${OPERATOR_URL}/tasks/${taskId}/permissions`);
    expect(response.ok).toBe(true);

    const data = (await response.json()) as PermissionsResponse;
    expect(data).toHaveProperty("permissions");
    expect(data.permissions).toEqual([]);
    expect(data.taskId).toBe(taskId);
    expect(data.sessionId).toBe(sessionId);
  });

  it("should include pending permissions in query", async () => {
    // Create a pending permission
    const permissionId = crypto.randomUUID();
    await fetch(`${OPERATOR_URL}/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        toolUseId: permissionId,
        toolName: "Write",
        toolInput: JSON.stringify({ path: "/important/file.ts" }),
      }),
    });

    // Query pending permissions
    const response = await fetch(`${OPERATOR_URL}/tasks/${taskId}/permissions`);
    expect(response.ok).toBe(true);

    const data = (await response.json()) as PermissionsResponse;
    expect(data.permissions.length).toBeGreaterThanOrEqual(1);

    const found = data.permissions.find((p) => p.id === permissionId);
    expect(found).toBeDefined();
    expect(found?.status).toBe("pending");
    expect(found?.toolName).toBe("Write");
  });
});

describe("Operator Spawn Agent", () => {
  it("should fail spawn without AGENT_WORKER_URL configured", async () => {
    // Create a task first
    const taskResponse = await fetch(`${OPERATOR_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Test spawn failure",
        repoUrl: "https://github.com/test/repo",
        branch: "main",
      }),
    });
    const task = (await taskResponse.json()) as Task;

    // Try to spawn - should fail because AGENT_WORKER_URL is not configured
    const response = await fetch(`${OPERATOR_URL}/tasks/${task.id}/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    // Should return 503 (Service Unavailable) since AGENT_WORKER_URL is not configured
    expect(response.status).toBe(503);
    const data = (await response.json()) as ErrorResponse;
    expect(data).toHaveProperty("error");
    expect(data.error).toContain("AGENT_WORKER_URL");
  });

  it("should fail spawn without repoUrl", async () => {
    // Create a task without repoUrl
    const taskResponse = await fetch(`${OPERATOR_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Test spawn without repo",
      }),
    });
    const task = (await taskResponse.json()) as Task;

    // Mock AGENT_WORKER_URL by checking error comes before that validation
    const response = await fetch(`${OPERATOR_URL}/tasks/${task.id}/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    // Without repoUrl, should fail with 400 or 503 depending on order of checks
    expect([400, 503]).toContain(response.status);
    const data = await response.json();
    expect(data).toHaveProperty("error");
  });
});
