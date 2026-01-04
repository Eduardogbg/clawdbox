/**
 * Codex runner service for Cloudflare Containers.
 *
 * Exposes:
 * - POST /run: runs codex exec and streams JSONL output
 * - GET /health: liveness check
 */
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as S from "effect/Schema";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const RunRequestSchema = S.Struct({
  prompt: S.String,
  sessionId: S.optional(S.String),
  workdir: S.optional(S.String),
});

type RunRequest = S.Schema.Type<typeof RunRequestSchema>;

const jsonHeaders = { "Content-Type": "application/json" };

const ensureApiKey = (): void => {
  const bunEnv = Bun.env;
  const codexKey = process.env.CODEX_API_KEY ?? bunEnv.CODEX_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY ?? bunEnv.OPENAI_API_KEY;
  if (!openaiKey && codexKey) {
    process.env.OPENAI_API_KEY = codexKey;
  }
  if (!codexKey && openaiKey) {
    process.env.CODEX_API_KEY = openaiKey;
  }
};

const buildEnvDebug = () => {
  const bunEnv = Bun.env;
  return {
    has_openai_key: Boolean(process.env.OPENAI_API_KEY),
    has_openai_key_bun: Boolean(bunEnv.OPENAI_API_KEY),
    has_codex_key: Boolean(process.env.CODEX_API_KEY),
    has_codex_key_bun: Boolean(bunEnv.CODEX_API_KEY),
    has_codex_profile: Boolean(process.env.CODEX_PROFILE),
    has_codex_profile_bun: Boolean(bunEnv.CODEX_PROFILE),
    has_codex_args: Boolean(process.env.CODEX_ARGS),
    has_codex_args_bun: Boolean(bunEnv.CODEX_ARGS),
  };
};

const splitArgs = (input: string): string[] => {
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escape = false;

  for (const char of input) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current.length > 0) {
    args.push(current);
  }
  return args;
};

const isReadableStream = (value: unknown): value is ReadableStream<Uint8Array> =>
  typeof (value as ReadableStream<Uint8Array>)?.getReader === "function";

const collectStderrTail = async (stream: ReadableStream<Uint8Array> | null): Promise<string> => {
  if (!stream) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > 4000) {
      buffer = buffer.slice(-4000);
    }
  }
  buffer += decoder.decode();
  return buffer.trim();
};

const normalizeCodexArgs = (raw: string | undefined): string[] => {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return splitArgs(trimmed.slice(1, -1));
  }
  return splitArgs(trimmed);
};

const buildCodexArgs = (request: RunRequest): string[] => {
  const extra = normalizeCodexArgs(process.env.CODEX_ARGS);
  const profile = process.env.CODEX_PROFILE;
  const args = ["codex"];
  if (profile) {
    args.push("--profile", profile);
  }
  args.push("exec", "--json", ...extra);
  if (request.sessionId) {
    args.push("resume", request.sessionId, request.prompt);
  } else {
    args.push(request.prompt);
  }
  return args;
};

const readStreamText = async (
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> => {
  if (!stream) return "";
  return new Response(stream).text();
};

const runCommand = async (cmd: string[], cwd?: string): Promise<void> => {
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode === 0) return;
  const stderr = await readStreamText(proc.stderr);
  const stdout = await readStreamText(proc.stdout);
  throw new Error(`${cmd.join(" ")} failed (${exitCode}): ${stderr || stdout}`);
};

let repoPromise: Promise<void> | null = null;

const ensureRepo = async (workdir: string): Promise<void> => {
  const repoUrl = process.env.REPO_URL;
  if (!repoUrl) {
    const gitDir = path.join(workdir, ".git");
    try {
      await fs.stat(gitDir);
      return;
    } catch {
      await fs.mkdir(workdir, { recursive: true });
      await runCommand(["git", "init"], workdir);
      return;
    }
  }
  if (repoPromise) {
    await repoPromise;
    return;
  }
  const branch = process.env.REPO_BRANCH ?? "main";
  repoPromise = (async () => {
    try {
      const gitDir = path.join(workdir, ".git");
      try {
        await fs.stat(gitDir);
        return;
      } catch {
        await fs.mkdir(workdir, { recursive: true });
        await runCommand(["git", "clone", "--depth", "1", "-b", branch, repoUrl, workdir]);
      }
    } catch (error) {
      repoPromise = null;
      throw error;
    }
  })();
  await repoPromise;
};

const runCodex = (request: RunRequest): Response => {
  ensureApiKey();
  const cmd = buildCodexArgs(request);
  const cwd = request.workdir ?? process.env.CODEX_WORKDIR ?? "/workspace/repo";
  console.log("[codex-container] run", {
    cwd,
    sessionId: request.sessionId ?? null,
    promptSize: request.prompt.length,
    args: cmd.slice(1),
  });
  const encoder = new TextEncoder();
  let proc: ReturnType<typeof Bun.spawn> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // ignore enqueue errors when stream is closed
        }
      };
      const pump = async () => {
        ensureApiKey();
        emit({ type: "run.started" });
        emit({
          type: "debug.env",
          ...buildEnvDebug(),
        });

        try {
          emit({ type: "debug.ensure_repo.start" });
          await ensureRepo(cwd);
          emit({ type: "debug.ensure_repo.done" });
          proc = Bun.spawn({
            cmd,
            cwd,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            env: process.env,
          });
          emit({ type: "debug.spawned" });
          emit({ type: "debug.prompt_arg" });

          const stderrPromise = collectStderrTail(
            isReadableStream(proc.stderr) ? proc.stderr : null,
          );

          if (isReadableStream(proc.stdout)) {
            const reader = proc.stdout.getReader();
            let sawOutput = false;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                if (!sawOutput) {
                  sawOutput = true;
                  emit({ type: "debug.stdout_first_chunk" });
                }
                controller.enqueue(value);
              }
            }
          }

          const exitCode = await proc.exited;
          const stderr = await stderrPromise;
          emit({ type: "debug.exit", exit_code: exitCode });
          console.log("[codex-container] exit", {
            exitCode,
            stderrSize: stderr.length,
          });
          if (exitCode !== 0) {
            const payload = JSON.stringify({
              type: "exec.failed",
              exit_code: exitCode,
              stderr: stderr || "codex exec failed",
            });
            controller.enqueue(encoder.encode(`${payload}\n`));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "codex exec failed";
          console.error("[codex-container] run error", { error: message });
          const payload = JSON.stringify({
            type: "exec.failed",
            exit_code: 1,
            stderr: message,
          });
          controller.enqueue(encoder.encode(`${payload}\n`));
        } finally {
          controller.close();
        }
      };
      pump().catch((error) => controller.error(error));
    },
    cancel() {
      if (proc) {
        proc.kill();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/jsonl; charset=utf-8" },
  });
};

const handler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return new Response(JSON.stringify({ status: "ok" }), { headers: jsonHeaders });
  }
  if (request.method === "GET" && url.pathname === "/debug/env") {
    ensureApiKey();
    return new Response(JSON.stringify(buildEnvDebug()), { headers: jsonHeaders });
  }
  if (request.method === "POST" && url.pathname === "/run") {
    const body = await request.json();
    const runRequest = await pipe(
      Effect.succeed(body),
      Effect.flatMap(S.decodeUnknown(RunRequestSchema)),
      Effect.mapError((error) => new Error(`Invalid run request: ${error}`)),
      Effect.runPromise,
    );
    try {
      return await runCodex(runRequest);
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "failed to run codex",
        }),
        { status: 500, headers: jsonHeaders },
      );
    }
  }
  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: jsonHeaders });
};

const port = Number(process.env.PORT ?? "8080");

Bun.serve({
  port,
  hostname: "0.0.0.0",
  fetch: handler,
});

console.log(`[codex-container] listening on 0.0.0.0:${port}`);
