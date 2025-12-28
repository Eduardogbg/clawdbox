import { config } from "dotenv";
config({ path: ".env" });

// Polyfill File constructor for Node.js if not available
if (typeof globalThis.File === "undefined") {
  const { File } = require("node:buffer");
  globalThis.File = File;
}

// Test naming convention: all test resources use "test-" prefix
export const TEST_PREFIX = "test-";

// Generate a unique test resource name
export function testName(base: string): string {
  return `${TEST_PREFIX}${base}-${Date.now()}`;
}
