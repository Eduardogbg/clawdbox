/**
 * Tests for Takopi config helpers
 */
import { describe, it, expect } from "bun:test";
import * as Effect from "effect/Effect";

import { decodeStartConfig, toContainerEnv } from "../src/config.js";

const validConfig = {
  botToken: "token",
  chatId: 123,
  repoUrl: "https://github.com/example/repo",
  repoBranch: "main",
  workdir: "/workspace/repo",
  openAiApiKey: "openai-key",
  codexProfile: "takopi",
  codexConfigToml: "[profiles.takopi]\nmodel = \"gpt-5\"\n",
  finalNotify: false,
  debug: true,
  githubPat: "ghp_abc",
};

describe("Takopi config", () => {
  it("decodes valid config", async () => {
    const decoded = await Effect.runPromise(decodeStartConfig(validConfig));

    expect(decoded.botToken).toBe(validConfig.botToken);
    expect(decoded.chatId).toBe(validConfig.chatId);
    expect(decoded.repoUrl).toBe(validConfig.repoUrl);
  });

  it("builds container env vars", async () => {
    const decoded = await Effect.runPromise(decodeStartConfig(validConfig));
    const env = toContainerEnv(decoded);

    expect(env.TAKOPI_BOT_TOKEN).toBe("token");
    expect(env.TAKOPI_CHAT_ID).toBe("123");
    expect(env.TAKOPI_REPO_URL).toBe(validConfig.repoUrl);
    expect(env.OPENAI_API_KEY).toBe("openai-key");
    expect(env.CODEX_PROFILE).toBe("takopi");
  });

  it("uses defaults for optional fields", async () => {
    const decoded = await Effect.runPromise(
      decodeStartConfig({
        botToken: "token",
        chatId: 99,
        repoUrl: "https://github.com/example/repo",
      }),
    );

    const env = toContainerEnv(decoded);
    expect(env.TAKOPI_REPO_BRANCH).toBe("main");
    expect(env.TAKOPI_WORKDIR).toBe("/workspace/repo");
    expect(env.TAKOPI_FINAL_NOTIFY).toBe("true");
  });
});
