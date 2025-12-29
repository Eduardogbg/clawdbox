/**
 * @clawdbox/agent-container
 *
 * Claude Agent SDK container for Cloudflare Containers.
 * This package provides the runtime for executing Claude agents
 * with full filesystem access in a containerized environment.
 *
 * @example
 * ```typescript
 * // Environment variables required:
 * // - ANTHROPIC_API_KEY: Claude API key
 * // - AGENT_CONFIG: JSON configuration
 * // - GITHUB_PAT: (optional) GitHub access token
 *
 * // The container runs automatically via Dockerfile entrypoint
 * ```
 *
 * @see ./entrypoint.ts for the main entry point
 */

export * from "./config.js";
export * from "./permission.js";
export * from "./repo.js";
