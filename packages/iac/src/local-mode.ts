/**
 * Local dev helper: runs agent-container + agent-worker against the local machine.
 */
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import { config } from "dotenv";
import * as path from "node:path";

config({ path: ".env" });

type ProcInfo = {
  label: string;
  proc: ReturnType<typeof Bun.spawn>;
};

type TelegramCommand = { command: string; description: string };

const buildEnv = (): Record<string, string> => ({
  ...process.env,
  LOCAL_RUNNER_URL: process.env.LOCAL_RUNNER_URL ?? "http://127.0.0.1:8080",
});

const spawnProcess = (
  label: string,
  cmd: string[],
  cwd: string,
  env: Record<string, string>,
  options?: { pipeOutput?: boolean },
) =>
  Effect.try({
    try: () => ({
      label,
      proc: Bun.spawn({
        cmd,
        cwd,
        env,
        stdout: options?.pipeOutput ? "pipe" : "inherit",
        stderr: options?.pipeOutput ? "pipe" : "inherit",
        stdin: "inherit",
      }),
    }),
    catch: (error) => new Error(`Failed to start ${label}: ${error}`),
  });

const withProcess = (
  label: string,
  cmd: string[],
  cwd: string,
  env: Record<string, string>,
  options?: { pipeOutput?: boolean },
) =>
  Effect.acquireUseRelease(
    spawnProcess(label, cmd, cwd, env, options),
    (info) => Effect.succeed(info),
    (info) =>
      Effect.sync(() => {
        try {
          info.proc.kill("SIGTERM");
        } catch {
          // ignore shutdown errors
        }
      }),
  );

const waitForExit = (info: ProcInfo) =>
  info.proc.exited.then((code) => ({ label: info.label, code }));

const tunnelUrlPattern = /https:\/\/[a-z0-9.-]+\.trycloudflare\.com/gi;
const lineSplitPattern = /[\r\n]+/;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const streamToConsole = async (
  stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream | null,
  sink: NodeJS.WritableStream,
  onLine?: (line: string) => void,
): Promise<void> => {
  if (!stream) return;
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (chunk: string) => {
    sink.write(chunk);
    buffer += chunk;
    const lines = buffer.split(lineSplitPattern);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      onLine?.(line);
    }
  };

  const reader = (stream as ReadableStream<Uint8Array>).getReader?.();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      flush(decoder.decode(value, { stream: true }));
    }
    if (buffer.length > 0) {
      onLine?.(buffer);
    }
    return;
  }

  const asyncStream = stream as AsyncIterable<Uint8Array | string>;
  if (Symbol.asyncIterator in asyncStream) {
    for await (const value of asyncStream) {
      const chunk =
        typeof value === "string" ? value : decoder.decode(value, { stream: true });
      flush(chunk);
    }
    if (buffer.length > 0) {
      onLine?.(buffer);
    }
    return;
  }

  const nodeStream = stream as NodeJS.ReadableStream;
  if (typeof nodeStream.on === "function") {
    nodeStream.on("data", (value: Buffer | string) => {
      const chunk = typeof value === "string" ? value : value.toString("utf8");
      flush(chunk);
    });
    nodeStream.on("end", () => {
      if (buffer.length > 0) {
        onLine?.(buffer);
        buffer = "";
      }
    });
  }
};

const detectTunnelUrl = async (
  proc: ProcInfo,
  timeoutMs = 20_000,
): Promise<string | null> => {
  let resolved = false;
  let resolveUrl: ((url: string | null) => void) | null = null;
  const tail: string[] = [];
  const urlPromise = new Promise<string | null>((resolve) => {
    resolveUrl = resolve;
  });

  const handleLine = (line: string) => {
    if (line.trim()) {
      tail.push(line);
      if (tail.length > 25) tail.shift();
    }
    if (resolved) return;
    const match = line.match(tunnelUrlPattern);
    if (match && match[0]) {
      resolved = true;
      resolveUrl?.(match[0]);
    }
  };

  const stdout = proc.proc.stdout as unknown as NodeJS.ReadableStream | null;
  const stderr = proc.proc.stderr as unknown as NodeJS.ReadableStream | null;
  void streamToConsole(stdout, process.stdout, handleLine);
  void streamToConsole(stderr, process.stderr, handleLine);

  return Promise.race([
    urlPromise,
    sleep(timeoutMs).then(() => null),
    proc.proc.exited.then(() => {
      const suffix = tail.length > 0 ? `\ntunnel tail:\n${tail.join("\n")}` : "";
      throw new Error(`tunnel exited before exposing a trycloudflare URL${suffix}`);
    }),
  ]);
};

const waitForLocalWorker = (url: string, attempts = 30) =>
  Effect.tryPromise({
    try: async () => {
      let lastError: string | null = null;
      for (let i = 0; i < attempts; i += 1) {
        try {
          const response = await fetch(`${url}/health`);
          if (response.ok) return;
          lastError = `status ${response.status}`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
        await sleep(1000);
      }
      throw new Error(`Worker not ready after ${attempts}s (${lastError ?? "unknown"})`);
    },
    catch: (error) => new Error(`Local worker readiness failed: ${error}`),
  });

const setWebhook = (
  botToken: string,
  url: string,
  secretToken?: string,
): Effect.Effect<void, Error> =>
  pipe(
    Effect.tryPromise({
      try: () =>
        fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            ...(secretToken ? { secret_token: secretToken } : {}),
          }),
        }),
      catch: (error) => new Error(`Webhook request failed: ${error}`),
    }),
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(new Error(`Webhook request failed (${response.status})`)),
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: (error) => new Error(`Webhook response JSON failed: ${error}`),
      }),
    ),
    Effect.tap((payload) =>
      Effect.logInfo(`Telegram webhook response: ${JSON.stringify(payload)}`),
    ),
    Effect.asVoid,
  );

const setBotCommands = (
  botToken: string,
  commands: TelegramCommand[],
): Effect.Effect<void, Error> =>
  pipe(
    Effect.tryPromise({
      try: () =>
        fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commands }),
        }),
      catch: (error) => new Error(`setMyCommands request failed: ${error}`),
    }),
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(new Error(`setMyCommands request failed (${response.status})`)),
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: (error) => new Error(`setMyCommands response JSON failed: ${error}`),
      }),
    ),
    Effect.tap((payload) =>
      Effect.logInfo(`Telegram commands response: ${JSON.stringify(payload)}`),
    ),
    Effect.asVoid,
  );

const main = Effect.gen(function* () {
  const env = buildEnv();
  const containerDir = path.resolve(import.meta.dirname, "../../agent-container");
  const workerDir = path.resolve(import.meta.dirname, "../../agent-worker");
  const workerConfigPath = path.resolve(workerDir, "wrangler.toml");
  const workerEntry = path.resolve(workerDir, "src/index.ts");
  const workerPort = process.env.LOCAL_WORKER_PORT ?? "8787";
  const localWorkerUrl = `http://127.0.0.1:${workerPort}`;

  const container = yield* withProcess(
    "container",
    ["bun", "run", "--watch", "src/index.ts"],
    containerDir,
    env,
  );
  const worker = yield* withProcess(
    "worker",
    [
      "npx",
      "wrangler",
      "dev",
      workerEntry,
      "--config",
      workerConfigPath,
      "--local",
      "--port",
      workerPort,
      "--show-interactive-dev-session",
      "false",
      "--log-level",
      "info",
    ],
    workerDir,
    env,
    { pipeOutput: false },
  );

  yield* waitForLocalWorker(localWorkerUrl, 30);

  const tunnel = yield* withProcess(
    "tunnel",
    [
      "cloudflared",
      "tunnel",
      "--url",
      localWorkerUrl,
      "--no-autoupdate",
    ],
    workerDir,
    env,
    { pipeOutput: true },
  );

  const tunnelUrl = yield* Effect.tryPromise({
    try: () => detectTunnelUrl(tunnel),
    catch: (error) => new Error(`Failed to detect tunnel URL: ${error}`),
  });
  if (!tunnelUrl) {
    return yield* Effect.fail(new Error("Tunnel did not emit a public URL"));
  }
  yield* Effect.logInfo(`Tunnel URL: ${tunnelUrl}`);

  const botToken = yield* pipe(
    Effect.succeed(process.env.TELEGRAM_BOT_TOKEN),
    Effect.flatMap((token) =>
      token
        ? Effect.succeed(token)
        : Effect.fail(new Error("TELEGRAM_BOT_TOKEN is required for local webhook")),
    ),
  );
  const secret = process.env.TELEGRAM_SECRET_TOKEN;
  yield* setWebhook(botToken, `${tunnelUrl}/webhook`, secret);
  yield* setBotCommands(botToken, [
    { command: "new", description: "Start a fresh session" },
    { command: "resume", description: "Resume a session by id" },
    { command: "cwd", description: "Set working directory (local only)" },
    { command: "help", description: "Show available commands" },
    { command: "settings", description: "Set this topic as the settings thread" },
    { command: "auth", description: "Store Cloudflare + Codex credentials" },
    { command: "rename", description: "Rename the current topic" },
  ]);

  const exit = yield* Effect.tryPromise({
    try: () => Promise.race([waitForExit(container), waitForExit(worker), waitForExit(tunnel)]),
    catch: (error) => new Error(`Failed waiting for processes: ${error}`),
  });

  yield* Effect.logInfo(`${exit.label} exited (${exit.code})`);
});

pipe(Effect.scoped(main), Effect.runPromise)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Local mode failed:", error);
    process.exit(1);
  });
