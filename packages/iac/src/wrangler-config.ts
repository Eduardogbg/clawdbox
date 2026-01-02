import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const imageLinePattern = /^image = ".*"$/m;
const mainLinePattern = /^main = "(.*)"$/m;

const replaceImageLine = (input: string, imageRef: string) => {
  const updated = input.replace(imageLinePattern, `image = "${imageRef}"`);
  if (updated === input) {
    throw new Error("Failed to update container image in wrangler config");
  }
  return updated;
};

const replaceMainLine = (input: string, sourceDir: string) => {
  const match = input.match(mainLinePattern);
  if (!match) {
    return input;
  }
  const mainPath = match[1];
  const absoluteMain = path.isAbsolute(mainPath)
    ? mainPath
    : path.resolve(sourceDir, mainPath);
  return input.replace(mainLinePattern, `main = "${absoluteMain}"`);
};

export const withWranglerConfig = <A, E, R>(
  sourcePath: string,
  imageRef: string,
  use: (configPath: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R> =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: async () => {
        const source = await fs.readFile(sourcePath, "utf8");
        const sourceDir = path.dirname(sourcePath);
        const updated = replaceMainLine(
          replaceImageLine(source, imageRef),
          sourceDir,
        );
        const tempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), "clawdbox-wrangler-"),
        );
        const configPath = path.join(tempDir, "wrangler.toml");
        await fs.writeFile(configPath, updated, "utf8");
        return configPath;
      },
      catch: (error) =>
        new Error(`Failed to create wrangler config: ${error}`),
    }),
    use,
    (configPath, _exit: Exit.Exit<A, E>) =>
      Effect.catchAll(
        Effect.tryPromise({
          try: () =>
            fs.rm(path.dirname(configPath), { recursive: true, force: true }),
          catch: (error) =>
            new Error(`Failed to cleanup wrangler config: ${error}`),
        }),
        (error) =>
          Effect.logWarning(`Wrangler config cleanup failed: ${error}`),
      ),
  );
