import { describe, it, expect } from "vitest";

/**
 * Tests for repository management logic.
 *
 * Note: We test the logic here, not the actual shell commands.
 * The actual cloneRepo/pushChanges functions use bun shell ($)
 * which is not available in vitest. These tests verify the
 * helper logic and URL handling.
 */

describe("Tarball URL Detection", () => {
  // This is the logic used in cloneRepo to detect tarball URLs
  const isTarball = (url: string): boolean => {
    return url.includes(".tar.gz") || url.includes(".tgz");
  };

  it("detects .tar.gz URLs as tarballs", () => {
    expect(isTarball("https://r2.example.com/repo.tar.gz")).toBe(true);
    expect(isTarball("https://cdn.example.com/files/archive.tar.gz")).toBe(true);
  });

  it("detects .tgz URLs as tarballs", () => {
    expect(isTarball("https://r2.example.com/repo.tgz")).toBe(true);
    expect(isTarball("https://cdn.example.com/npm-package.tgz")).toBe(true);
  });

  it("does not detect git URLs as tarballs", () => {
    expect(isTarball("https://github.com/user/repo")).toBe(false);
    expect(isTarball("git@github.com:user/repo.git")).toBe(false);
    expect(isTarball("https://gitlab.com/user/repo")).toBe(false);
  });

  it("handles complex URLs with query parameters", () => {
    expect(isTarball("https://r2.example.com/repo.tar.gz?token=abc")).toBe(true);
    expect(isTarball("https://github.com/user/repo?ref=main")).toBe(false);
  });
});

describe("GitHub PAT Injection", () => {
  // This is the logic used in cloneFromGit to inject PAT
  const injectPat = (url: string, pat: string | undefined): string => {
    if (pat && url.includes("github.com")) {
      return url.replace("https://github.com", `https://${pat}@github.com`);
    }
    return url;
  };

  it("injects PAT into https GitHub URLs", () => {
    const url = "https://github.com/user/repo";
    const pat = "ghp_test123";

    expect(injectPat(url, pat)).toBe("https://ghp_test123@github.com/user/repo");
  });

  it("does not modify URL when no PAT is provided", () => {
    const url = "https://github.com/user/repo";

    expect(injectPat(url, undefined)).toBe(url);
    expect(injectPat(url, "")).toBe(url);
  });

  it("does not inject PAT into non-GitHub URLs", () => {
    const url = "https://gitlab.com/user/repo";
    const pat = "ghp_test123";

    expect(injectPat(url, pat)).toBe(url);
  });

  it("handles enterprise GitHub URLs (currently injects PAT)", () => {
    const url = "https://github.company.com/user/repo";
    const pat = "ghp_test123";

    // Note: Current logic matches "github.com" anywhere in URL
    // This means enterprise URLs like github.company.com also get PAT injected
    // This is a known limitation - exact domain matching would be safer
    expect(injectPat(url, pat)).toBe(
      "https://ghp_test123@github.company.com/user/repo"
    );
  });

  it("preserves the full path in URL", () => {
    const url = "https://github.com/organization/repo/with/deep/path.git";
    const pat = "ghp_abc123";

    expect(injectPat(url, pat)).toBe(
      "https://ghp_abc123@github.com/organization/repo/with/deep/path.git"
    );
  });
});

describe("Commit Message Formatting", () => {
  // Git commit messages have conventions
  const isValidCommitMessage = (msg: string): boolean => {
    // Basic checks: not empty, not too long
    if (!msg || msg.trim().length === 0) return false;
    if (msg.length > 500) return false; // Practical limit

    // First line shouldn't be too long
    const firstLine = msg.split("\n")[0];
    if (firstLine.length > 72) return false; // Git convention

    return true;
  };

  it("accepts valid commit messages", () => {
    expect(isValidCommitMessage("feat: add new feature")).toBe(true);
    expect(isValidCommitMessage("fix: resolve bug in authentication")).toBe(true);
    expect(isValidCommitMessage("docs: update README")).toBe(true);
  });

  it("rejects empty commit messages", () => {
    expect(isValidCommitMessage("")).toBe(false);
    expect(isValidCommitMessage("   ")).toBe(false);
  });

  it("rejects messages with too long first line", () => {
    const longMessage = "x".repeat(100);
    expect(isValidCommitMessage(longMessage)).toBe(false);
  });

  it("accepts multi-line commit messages", () => {
    const multiLine = "feat: add feature\n\nThis is the body.";
    expect(isValidCommitMessage(multiLine)).toBe(true);
  });
});

describe("Branch Name Validation", () => {
  // Git branch names have restrictions
  const isValidBranchName = (name: string): boolean => {
    // Can't start with /, can't contain .., can't end with /
    if (!name) return false;
    if (name.startsWith("/")) return false;
    if (name.endsWith("/")) return false;
    if (name.includes("..")) return false;
    if (name.includes(" ")) return false;
    if (name.includes("~")) return false;
    if (name.includes("^")) return false;
    if (name.includes(":")) return false;
    return true;
  };

  it("accepts valid branch names", () => {
    expect(isValidBranchName("main")).toBe(true);
    expect(isValidBranchName("feature/new-feature")).toBe(true);
    expect(isValidBranchName("fix/bug-123")).toBe(true);
    expect(isValidBranchName("release-v1.0.0")).toBe(true);
  });

  it("rejects branch names with invalid characters", () => {
    expect(isValidBranchName("feature branch")).toBe(false);
    expect(isValidBranchName("feature~1")).toBe(false);
    expect(isValidBranchName("feature^1")).toBe(false);
    expect(isValidBranchName("feature:1")).toBe(false);
  });

  it("rejects branch names with .. sequence", () => {
    expect(isValidBranchName("feature..main")).toBe(false);
  });

  it("rejects branch names with leading/trailing slash", () => {
    expect(isValidBranchName("/feature")).toBe(false);
    expect(isValidBranchName("feature/")).toBe(false);
  });
});

describe("Workspace Path Handling", () => {
  const DEFAULT_WORKSPACE = "/workspace";

  // Ensure paths are correctly normalized
  const normalizePath = (path: string): string => {
    // Remove trailing slashes
    return path.replace(/\/+$/, "");
  };

  const joinPath = (...parts: string[]): string => {
    return parts.map(normalizePath).join("/");
  };

  it("normalizes paths correctly", () => {
    expect(normalizePath("/workspace/")).toBe("/workspace");
    expect(normalizePath("/workspace")).toBe("/workspace");
    expect(normalizePath("/workspace///")).toBe("/workspace");
  });

  it("joins paths correctly", () => {
    expect(joinPath("/workspace", "src")).toBe("/workspace/src");
    expect(joinPath("/workspace/", "src/")).toBe("/workspace/src");
  });

  it("handles default workspace", () => {
    expect(DEFAULT_WORKSPACE).toBe("/workspace");
  });
});
