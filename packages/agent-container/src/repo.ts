/**
 * Repository Management
 *
 * Handles cloning and syncing repositories for agent work.
 */
import * as Effect from "effect/Effect";
import { $ } from "bun";

/**
 * Clone a repository from a URL
 *
 * Supports:
 * - R2 presigned URLs (tarball)
 * - GitHub URLs (direct clone)
 */
export const cloneRepo = (repoUrl: string, branch: string) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Cloning repository: ${repoUrl} (branch: ${branch})`);

    // Check if it's a tarball URL (R2)
    if (repoUrl.includes(".tar.gz") || repoUrl.includes(".tgz")) {
      yield* cloneFromTarball(repoUrl);
    } else {
      yield* cloneFromGit(repoUrl, branch);
    }

    yield* Effect.logInfo("Repository cloned successfully");
  });

/**
 * Clone from a tarball URL (R2 snapshot)
 */
const cloneFromTarball = (url: string) =>
  Effect.tryPromise({
    try: async () => {
      // Download and extract tarball
      await $`curl -L -o /tmp/repo.tar.gz "${url}"`;
      await $`tar -xzf /tmp/repo.tar.gz -C /workspace`;
      await $`rm /tmp/repo.tar.gz`;
    },
    catch: (error) => new Error(`Failed to clone from tarball: ${error}`),
  });

/**
 * Clone from a git URL
 */
const cloneFromGit = (url: string, branch: string) =>
  Effect.tryPromise({
    try: async () => {
      // Check for GitHub PAT
      const pat = process.env.GITHUB_PAT;
      let cloneUrl = url;

      // Add auth to GitHub URLs if PAT is available
      if (pat && url.includes("github.com")) {
        cloneUrl = url.replace(
          "https://github.com",
          `https://${pat}@github.com`,
        );
      }

      // Clone with depth 1 for speed
      await $`git clone --depth 1 -b ${branch} ${cloneUrl} /workspace`;
    },
    catch: (error) => new Error(`Failed to clone from git: ${error}`),
  });

/**
 * Push changes back to the repository
 */
export const pushChanges = (
  branch: string,
  commitMessage: string,
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Pushing changes to branch: ${branch}`);

    yield* Effect.tryPromise({
      try: async () => {
        // Add all changes
        await $`git add -A`.cwd("/workspace");

        // Check if there are changes to commit
        const status = await $`git status --porcelain`.cwd("/workspace");
        if (!status.stdout.toString().trim()) {
          console.log("No changes to commit");
          return;
        }

        // Commit
        await $`git commit -m ${commitMessage}`.cwd("/workspace");

        // Push
        await $`git push origin ${branch}`.cwd("/workspace");
      },
      catch: (error) => new Error(`Failed to push changes: ${error}`),
    });

    yield* Effect.logInfo("Changes pushed successfully");
  });

/**
 * Create a snapshot tarball of the current workspace
 */
export const createSnapshot = (outputPath: string) =>
  Effect.tryPromise({
    try: async () => {
      await $`tar -czf ${outputPath} -C /workspace .`;
    },
    catch: (error) => new Error(`Failed to create snapshot: ${error}`),
  });
