import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitCliAdapter } from "../src/git-cli-adapter.js";

const execFile = promisify(execFileCallback);

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("GitCliAdapter", () => {
  it("handles branch operations and head sha queries", async () => {
    const repoRoot = await createRepository();
    const adapter = new GitCliAdapter({ repoRoot });

    expect(await adapter.currentBranch()).toBe("main");
    expect(await adapter.branchExists("main")).toBe(true);
    expect(await adapter.branchExists("sf/feature/x")).toBe(false);

    await adapter.createBranch("sf/feature/x");

    expect(await adapter.currentBranch()).toBe("sf/feature/x");
    expect(await adapter.branchExists("sf/feature/x")).toBe(true);
    expect((await adapter.headSha("sf/feature/x")).length).toBe(40);
  });

  it("detects drift and merges main into current branch", async () => {
    const repoRoot = await createRepository();
    const adapter = new GitCliAdapter({ repoRoot });

    await adapter.createBranch("sf/feature/drift-check");
    expect(await adapter.isMainDrifted("main")).toBe(false);

    await rawGit(repoRoot, ["checkout", "main"]);
    await writeFile(join(repoRoot, "README.md"), "main change\n", "utf8");
    await rawGit(repoRoot, ["add", "README.md"]);
    await rawGit(repoRoot, ["commit", "-m", "main change"]);

    await rawGit(repoRoot, ["checkout", "sf/feature/drift-check"]);

    expect(await adapter.isMainDrifted("main")).toBe(true);

    const mergeResult = await adapter.mergeMainIntoCurrent("main");
    expect(mergeResult.status).toBe("merged");

    const mergedReadme = await readFile(join(repoRoot, "README.md"), "utf8");
    expect(mergedReadme).toContain("main change");
  });

  it("returns conflict metadata and supports conflict-resolution hooks", async () => {
    const repoRoot = await createRepository();
    const adapter = new GitCliAdapter({ repoRoot });

    await adapter.createBranch("sf/feature/conflict");
    await writeFile(join(repoRoot, "README.md"), "feature version\n", "utf8");
    await rawGit(repoRoot, ["add", "README.md"]);
    await rawGit(repoRoot, ["commit", "-m", "feature edit"]);

    await rawGit(repoRoot, ["checkout", "main"]);
    await writeFile(join(repoRoot, "README.md"), "main version\n", "utf8");
    await rawGit(repoRoot, ["add", "README.md"]);
    await rawGit(repoRoot, ["commit", "-m", "main edit"]);

    await rawGit(repoRoot, ["checkout", "sf/feature/conflict"]);

    const mergeResult = await adapter.mergeMainIntoCurrent("main");
    expect(mergeResult.status).toBe("conflict");
    expect(mergeResult.conflictFiles).toEqual(["README.md"]);

    const conflictFiles = await adapter.detectConflictFiles();
    expect(conflictFiles).toEqual(["README.md"]);

    await writeFile(join(repoRoot, "README.md"), "resolved content\n", "utf8");
    await adapter.markConflictFilesResolved(["README.md"]);
    await adapter.continueMerge("resolve conflict");

    const resolved = await readFile(join(repoRoot, "README.md"), "utf8");
    expect(resolved).toContain("resolved content");
  });

  it("supports rebase-main drift strategy integration", async () => {
    const repoRoot = await createRepository();
    const adapter = new GitCliAdapter({ repoRoot });

    await adapter.createBranch("sf/feature/rebase");

    await rawGit(repoRoot, ["checkout", "main"]);
    await writeFile(join(repoRoot, "README.md"), "main rebase change\n", "utf8");
    await rawGit(repoRoot, ["add", "README.md"]);
    await rawGit(repoRoot, ["commit", "-m", "main rebase change"]);

    await rawGit(repoRoot, ["checkout", "sf/feature/rebase"]);

    const result = await adapter.mergeMainIntoCurrent("main", "rebase-main");
    expect(["merged", "up_to_date"]).toContain(result.status);

    const readme = await readFile(join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("main rebase change");
  });
});

async function createRepository(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "specforge-git-"));
  tempDirectories.push(repoRoot);

  await rawGit(repoRoot, ["init", "-b", "main"]);
  await rawGit(repoRoot, ["config", "user.name", "SpecForge Test"]);
  await rawGit(repoRoot, ["config", "user.email", "specforge@example.test"]);

  await writeFile(join(repoRoot, "README.md"), "initial\n", "utf8");
  await rawGit(repoRoot, ["add", "README.md"]);
  await rawGit(repoRoot, ["commit", "-m", "initial commit"]);

  return repoRoot;
}

async function rawGit(repoRoot: string, args: string[]): Promise<void> {
  await execFile("git", args, {
    cwd: repoRoot,
    env: process.env,
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}
