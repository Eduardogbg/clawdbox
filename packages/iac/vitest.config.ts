import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120000,
    hookTimeout: 120000,
    passWithNoTests: true,
    include: ["test/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
    ],
    env: {
      NODE_ENV: "test",
    },
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
});
