# Git Repository Handling

> Managing git repos with R2 storage and ephemeral clones

## Overview

Unlike claude-army's local git worktrees, clawdbox uses:

1. **R2 Storage**: Repository snapshots stored as tar.gz archives
2. **Ephemeral Clones**: Each agent gets a fresh clone in its container
3. **GitHub as Source of Truth**: All merges happen via GitHub

```
┌─────────────────────────────────────────────────────────────┐
│                    GIT FLOW                                  │
│                                                             │
│   GitHub ◄───────────────────────────────────────────┐      │
│     │                                                │      │
│     │ webhook / poll                          push   │      │
│     ▼                                                │      │
│   ┌─────────┐    snapshot    ┌─────────┐    work    │      │
│   │   R2    │ ◄───────────── │ Container│ ──────────┘      │
│   │ Storage │ ───────────► │  Agent   │                   │
│   └─────────┘    restore     └─────────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## R2 Bucket Structure

```
clawdbox-repos/
├── repos/
│   └── {owner}/
│       └── {repo}/
│           ├── snapshots/
│           │   ├── main-{timestamp}.tar.gz
│           │   ├── main-{timestamp}.tar.gz  (older)
│           │   └── feature-xyz-{timestamp}.tar.gz
│           ├── latest/
│           │   ├── main.tar.gz  (symlink to latest snapshot)
│           │   └── feature-xyz.tar.gz
│           └── metadata.json
└── workspaces/
    └── {task-id}/
        ├── changes.patch       # Uncommitted changes backup
        └── session-state.json  # Agent session info
```

## Repository Registration

### Register a Repository

```typescript
// Register repo for clawdbox to track
const registerRepo = (owner: string, repo: string, defaultBranch: string = "main") =>
  Effect.gen(function* () {
    // Initial snapshot from GitHub
    yield* createSnapshot(owner, repo, defaultBranch);

    // Store metadata
    const metadata = {
      owner,
      repo,
      defaultBranch,
      registeredAt: Date.now(),
      lastSnapshot: Date.now(),
    };

    yield* Effect.tryPromise(() =>
      env.REPOS.put(
        `repos/${owner}/${repo}/metadata.json`,
        JSON.stringify(metadata)
      )
    );
  });
```

### Metadata Schema

```typescript
interface RepoMetadata {
  owner: string;
  repo: string;
  defaultBranch: string;
  registeredAt: number;
  lastSnapshot: number;
  branches: {
    [branch: string]: {
      lastCommit: string;
      snapshotAt: number;
    };
  };
}
```

## Snapshot Operations

### Create Snapshot

```typescript
const createSnapshot = (owner: string, repo: string, branch: string) =>
  Effect.gen(function* () {
    const timestamp = Date.now();
    const key = `repos/${owner}/${repo}/snapshots/${branch}-${timestamp}.tar.gz`;

    // Clone from GitHub (shallow)
    const tempDir = yield* createTempDir();

    yield* Effect.tryPromise(() =>
      $`git clone --depth 1 -b ${branch} https://github.com/${owner}/${repo}.git ${tempDir}`
    );

    // Create tarball
    const tarball = yield* Effect.tryPromise(() =>
      $`tar -czf - -C ${tempDir} .`.blob()
    );

    // Upload to R2
    yield* Effect.tryPromise(() =>
      env.REPOS.put(key, tarball, {
        customMetadata: {
          branch,
          timestamp: timestamp.toString(),
          commit: yield* getHeadCommit(tempDir),
        },
      })
    );

    // Update latest pointer
    yield* Effect.tryPromise(() =>
      env.REPOS.put(`repos/${owner}/${repo}/latest/${branch}.tar.gz`, tarball)
    );

    yield* cleanupTempDir(tempDir);
  });
```

### Restore Snapshot

```typescript
const restoreSnapshot = (owner: string, repo: string, branch: string, targetDir: string) =>
  Effect.gen(function* () {
    // Get latest snapshot
    const key = `repos/${owner}/${repo}/latest/${branch}.tar.gz`;
    const snapshot = yield* Effect.tryPromise(() => env.REPOS.get(key));

    if (!snapshot) {
      yield* Effect.fail(new Error(`No snapshot found for ${owner}/${repo}:${branch}`));
    }

    // Extract to target
    yield* Effect.tryPromise(async () => {
      const buffer = await snapshot.arrayBuffer();
      await $`tar -xzf - -C ${targetDir}`.stdin(new Uint8Array(buffer));
    });

    // Configure git for commits
    yield* Effect.tryPromise(() =>
      $`git -C ${targetDir} config user.email "clawdbox@example.com"`
    );
    yield* Effect.tryPromise(() =>
      $`git -C ${targetDir} config user.name "Clawdbox Agent"`
    );
  });
```

## Agent Workflow

### Task Start

```typescript
const startAgentTask = (taskId: string, config: TaskConfig) =>
  Effect.gen(function* () {
    // 1. Spawn container
    const container = yield* spawnContainer(taskId);

    // 2. Restore repo in container
    yield* containerExec(container, async () => {
      await restoreSnapshot(config.owner, config.repo, config.branch, "/workspace");
    });

    // 3. If working on existing branch, apply any saved changes
    if (config.resumeFrom) {
      const patch = yield* Effect.tryPromise(() =>
        env.REPOS.get(`workspaces/${config.resumeFrom}/changes.patch`)
      );
      if (patch) {
        yield* containerExec(container, async () => {
          await $`git -C /workspace apply`.stdin(await patch.text());
        });
      }
    }

    // 4. Run agent
    yield* runAgent(container, config.prompt);
  });
```

### Task Completion

```typescript
const completeAgentTask = (taskId: string, container: Container, success: boolean) =>
  Effect.gen(function* () {
    if (success) {
      // 1. Create feature branch
      const branchName = `clawdbox/${taskId}`;
      yield* containerExec(container, async () => {
        await $`git -C /workspace checkout -b ${branchName}`;
        await $`git -C /workspace add -A`;
        await $`git -C /workspace commit -m "Changes from clawdbox task ${taskId}"`;
      });

      // 2. Push to GitHub
      yield* containerExec(container, async () => {
        await $`git -C /workspace push origin ${branchName}`;
      });

      // 3. Optionally create PR
      yield* createPullRequest(taskId, branchName);
    } else {
      // Save uncommitted changes for potential resume
      yield* backupChanges(taskId, container);
    }

    // 4. Cleanup container
    yield* terminateContainer(container);
  });
```

### Backup Changes

```typescript
const backupChanges = (taskId: string, container: Container) =>
  Effect.gen(function* () {
    // Create patch of uncommitted changes
    const patch = yield* containerExec(container, async () => {
      return await $`git -C /workspace diff HEAD`.text();
    });

    if (patch.trim()) {
      yield* Effect.tryPromise(() =>
        env.REPOS.put(`workspaces/${taskId}/changes.patch`, patch)
      );
    }

    // Save untracked files list
    const untracked = yield* containerExec(container, async () => {
      return await $`git -C /workspace ls-files --others --exclude-standard`.text();
    });

    if (untracked.trim()) {
      yield* Effect.tryPromise(() =>
        env.REPOS.put(`workspaces/${taskId}/untracked.txt`, untracked)
      );
    }
  });
```

## Multi-Agent Collaboration

When multiple agents work on the same repo:

```
┌─────────────────────────────────────────────────────────────┐
│                  MULTI-AGENT WORKFLOW                        │
│                                                             │
│   Agent 1 (fix-bug)        Agent 2 (add-feature)           │
│   ┌─────────────┐          ┌─────────────┐                  │
│   │ Clone main  │          │ Clone main  │                  │
│   │ Work...     │          │ Work...     │                  │
│   │ Push branch │          │ Push branch │                  │
│   └──────┬──────┘          └──────┬──────┘                  │
│          │                        │                         │
│          ▼                        ▼                         │
│   ┌─────────────────────────────────────┐                   │
│   │            GitHub                    │                   │
│   │  PR: fix-bug    PR: add-feature     │                   │
│   │       │              │               │                   │
│   │       └──────┬───────┘               │                   │
│   │              ▼                       │                   │
│   │         Merge to main               │                   │
│   └─────────────────────────────────────┘                   │
│                    │                                        │
│                    ▼                                        │
│            New snapshot created                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Conflict Resolution

Conflicts are handled at the GitHub PR level:

1. Agent pushes to feature branch
2. PR created automatically
3. If conflicts with main, user resolves in GitHub UI
4. Agent can be resumed after merge if needed

## Snapshot Sync

### GitHub Webhook

Keep snapshots in sync with GitHub:

```typescript
// Handle GitHub webhook for push events
const handleGitHubPush = (payload: PushEvent) =>
  Effect.gen(function* () {
    const { repository, ref } = payload;
    const branch = ref.replace("refs/heads/", "");

    // Create new snapshot
    yield* createSnapshot(
      repository.owner.login,
      repository.name,
      branch
    );
  });
```

### Scheduled Sync

Fallback for repos without webhooks:

```typescript
// Cron trigger: every hour
const syncAllRepos = Effect.gen(function* () {
  const repos = yield* listRegisteredRepos();

  for (const repo of repos) {
    // Check if GitHub has newer commits
    const latestCommit = yield* getGitHubLatestCommit(repo.owner, repo.repo, repo.defaultBranch);
    const snapshotCommit = yield* getSnapshotCommit(repo.owner, repo.repo, repo.defaultBranch);

    if (latestCommit !== snapshotCommit) {
      yield* createSnapshot(repo.owner, repo.repo, repo.defaultBranch);
    }
  }
});
```

## Cleanup

### Snapshot Retention

```typescript
const cleanupOldSnapshots = (owner: string, repo: string, keepCount: number = 5) =>
  Effect.gen(function* () {
    const prefix = `repos/${owner}/${repo}/snapshots/`;
    const objects = yield* Effect.tryPromise(() =>
      env.REPOS.list({ prefix })
    );

    // Group by branch
    const byBranch = new Map<string, R2Object[]>();
    for (const obj of objects.objects) {
      const match = obj.key.match(/snapshots\/(.+)-\d+\.tar\.gz$/);
      if (match) {
        const branch = match[1];
        if (!byBranch.has(branch)) byBranch.set(branch, []);
        byBranch.get(branch)!.push(obj);
      }
    }

    // Keep only latest N per branch
    for (const [branch, snapshots] of byBranch) {
      const sorted = snapshots.sort((a, b) =>
        (b.uploaded?.getTime() ?? 0) - (a.uploaded?.getTime() ?? 0)
      );

      for (const old of sorted.slice(keepCount)) {
        yield* Effect.tryPromise(() => env.REPOS.delete(old.key));
      }
    }
  });
```

### Workspace Cleanup

```typescript
const cleanupWorkspace = (taskId: string) =>
  Effect.gen(function* () {
    const prefix = `workspaces/${taskId}/`;
    const objects = yield* Effect.tryPromise(() =>
      env.REPOS.list({ prefix })
    );

    for (const obj of objects.objects) {
      yield* Effect.tryPromise(() => env.REPOS.delete(obj.key));
    }
  });
```

## Comparison with claude-army

| Aspect | claude-army | clawdbox |
|--------|-------------|----------|
| Storage | Local filesystem | R2 object storage |
| Isolation | Git worktrees | Ephemeral container clones |
| Branching | Local worktree branches | Feature branches on GitHub |
| Persistence | Survives daemon restart | Survives container termination |
| Multi-agent | Shared filesystem | Isolated clones + GitHub merge |
| Recovery | Worktree state | Patch backup in R2 |
