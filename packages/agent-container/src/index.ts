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

const isWritableStream = (value: unknown): value is WritableStream<Uint8Array> =>
  typeof (value as WritableStream<Uint8Array>)?.getWriter === "function";

const isNodeWritable = (
  value: unknown,
): value is {
  write: (chunk: string, cb?: (error?: Error | null) => void) => void;
  end?: (cb?: () => void) => void;
} => typeof (value as { write?: unknown }).write === "function";

const writePrompt = async (stdin: unknown, prompt: string): Promise<void> => {
  if (!stdin) {
    throw new Error("codex stdin is not available");
  }
  const text = prompt.endsWith("\n") ? prompt : `${prompt}\n`;
  if (isWritableStream(stdin)) {
    const writer = stdin.getWriter();
    await writer.write(new TextEncoder().encode(text));
    await writer.close();
    return;
  }
  if (isNodeWritable(stdin)) {
    await new Promise<void>((resolve, reject) => {
      stdin.write(text, (error) => {
        if (error) return reject(error);
        if (stdin.end) {
          stdin.end(() => resolve());
        } else {
          resolve();
        }
      });
    });
    return;
  }
  throw new Error("unsupported stdin interface");
};

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

const buildCodexArgs = (request: RunRequest): string[] => {
  const extra = process.env.CODEX_ARGS ? splitArgs(process.env.CODEX_ARGS) : [];
  const profile = process.env.CODEX_PROFILE;
  const args = ["codex"];
  if (profile) {
    args.push("--profile", profile);
  }
  args.push(...extra, "exec", "--json");
  if (request.sessionId) {
    args.push("resume", request.sessionId, "-");
  } else {
    args.push("-");
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
  if (!repoUrl) return;
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

const runCodex = async (request: RunRequest): Promise<Response> => {
  const cmd = buildCodexArgs(request);
  const cwd = request.workdir ?? process.env.CODEX_WORKDIR ?? "/workspace/repo";
  await ensureRepo(cwd);
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  await writePrompt(proc.stdin, request.prompt);

  const stderrPromise = collectStderrTail(proc.stderr);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = async () => {
        if (proc.stdout) {
          const reader = proc.stdout.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
        }
        const exitCode = await proc.exited;
        const stderr = await stderrPromise;
        if (exitCode !== 0) {
          const payload = JSON.stringify({
            type: "exec.failed",
            exit_code: exitCode,
            stderr: stderr || "codex exec failed",
          });
          controller.enqueue(encoder.encode(`${payload}\n`));
        }
        controller.close();
      };
      pump().catch((error) => controller.error(error));
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
  fetch: handler,
});

console.log(`[codex-container] listening on ${port}`);
