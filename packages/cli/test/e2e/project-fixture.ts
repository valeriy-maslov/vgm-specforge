import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function createProjectFixture(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function initializeGitRepository(projectRoot: string): Promise<void> {
  await runGit(projectRoot, ["init"]);
  await runGit(projectRoot, ["branch", "-M", "main"]);
  await runGit(projectRoot, ["config", "user.email", "specforge@example.com"]);
  await runGit(projectRoot, ["config", "user.name", "Specforge Test"]);

  await writeFile(join(projectRoot, "README.md"), "# Fixture\n", "utf8");
  await runGit(projectRoot, ["add", "README.md"]);
  await runGit(projectRoot, ["commit", "-m", "Initial commit"]);
}

export async function writeRuntimeConfig(projectRoot: string, config: Record<string, unknown>): Promise<void> {
  await mkdir(join(projectRoot, ".specforge"), {
    recursive: true,
  });
  await writeFile(join(projectRoot, ".specforge/config.yaml"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function runGit(projectRoot: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFile("git", [...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  return {
    stdout: result.stdout.trimEnd(),
    stderr: result.stderr.trimEnd(),
  };
}
