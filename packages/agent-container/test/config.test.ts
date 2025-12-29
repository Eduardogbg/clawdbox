/**
 * Agent Configuration Tests
 *
 * Tests for configuration schema validation.
 */
import { describe, it, expect } from "vitest";
import * as S from "effect/Schema";
import { AgentConfig, AgentEnv } from "../src/config.js";

describe("AgentConfig Schema", () => {
  it("should parse valid config", () => {
    const config = {
      taskId: "test-123",
      prompt: "Fix the login bug",
      repoUrl: "https://github.com/user/repo.git",
      branch: "main",
      operatorUrl: "https://operator.example.com",
    };

    const result = S.decodeUnknownSync(AgentConfig)(config);

    expect(result.taskId).toBe("test-123");
    expect(result.prompt).toBe("Fix the login bug");
    expect(result.repoUrl).toBe("https://github.com/user/repo.git");
    expect(result.branch).toBe("main");
    expect(result.operatorUrl).toBe("https://operator.example.com");
  });

  it("should accept optional sessionId", () => {
    const config = {
      taskId: "test-123",
      prompt: "Fix the login bug",
      repoUrl: "https://github.com/user/repo.git",
      branch: "main",
      operatorUrl: "https://operator.example.com",
      sessionId: "session-abc",
    };

    const result = S.decodeUnknownSync(AgentConfig)(config);

    expect(result.sessionId).toBe("session-abc");
  });

  it("should accept optional workingDirectory", () => {
    const config = {
      taskId: "test-123",
      prompt: "Fix the login bug",
      repoUrl: "https://github.com/user/repo.git",
      branch: "main",
      operatorUrl: "https://operator.example.com",
      workingDirectory: "/workspace/subdir",
    };

    const result = S.decodeUnknownSync(AgentConfig)(config);

    expect(result.workingDirectory).toBe("/workspace/subdir");
  });

  it("should reject missing required fields", () => {
    const config = {
      taskId: "test-123",
      prompt: "Fix the login bug",
      // Missing repoUrl, branch, operatorUrl
    };

    expect(() => S.decodeUnknownSync(AgentConfig)(config)).toThrow();
  });

  it("should reject wrong types", () => {
    const config = {
      taskId: 123, // Should be string
      prompt: "Fix the login bug",
      repoUrl: "https://github.com/user/repo.git",
      branch: "main",
      operatorUrl: "https://operator.example.com",
    };

    expect(() => S.decodeUnknownSync(AgentConfig)(config)).toThrow();
  });
});

describe("AgentEnv Schema", () => {
  it("should parse valid environment", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-xxx",
      AGENT_CONFIG: '{"taskId": "test"}',
    };

    const result = S.decodeUnknownSync(AgentEnv)(env);

    expect(result.ANTHROPIC_API_KEY).toBe("sk-ant-xxx");
    expect(result.AGENT_CONFIG).toBe('{"taskId": "test"}');
  });

  it("should accept optional GITHUB_PAT", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-xxx",
      GITHUB_PAT: "ghp_xxx",
      AGENT_CONFIG: '{"taskId": "test"}',
    };

    const result = S.decodeUnknownSync(AgentEnv)(env);

    expect(result.GITHUB_PAT).toBe("ghp_xxx");
  });

  it("should reject missing ANTHROPIC_API_KEY", () => {
    const env = {
      AGENT_CONFIG: '{"taskId": "test"}',
    };

    expect(() => S.decodeUnknownSync(AgentEnv)(env)).toThrow();
  });

  it("should reject missing AGENT_CONFIG", () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-xxx",
    };

    expect(() => S.decodeUnknownSync(AgentEnv)(env)).toThrow();
  });
});
