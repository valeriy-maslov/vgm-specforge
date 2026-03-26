import { execFile as execFileCallback, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import { SpecforgeError, type DriftStrategy, type GitPort, type MergeResult } from "@specforge/contracts";

const execFile = promisify(execFileCallback);

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitCliAdapterOptions {
  repoRoot: string;
  gitBinary?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export class GitCliAdapter implements GitPort {
  private readonly repoRoot: string;

  private readonly gitBinary: string;

  private readonly timeoutMs: number;

  private readonly maxBufferBytes: number;

  private readonly env: NodeJS.ProcessEnv;

  constructor(options: GitCliAdapterOptions) {
    this.repoRoot = options.repoRoot;
    this.gitBinary = options.gitBinary ?? "git";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxBufferBytes = options.maxBufferBytes ?? 2 * 1024 * 1024;
    this.env = {
      ...process.env,
      ...(options.env ?? {}),
    };
  }

  async currentBranch(): Promise<string> {
    const result = await this.runGitStrict(["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = result.stdout.trim();
    if (branch.length === 0) {
      throw new SpecforgeError("GIT_ADAPTER_ERROR", "unable to determine current branch", {
        command: "rev-parse --abbrev-ref HEAD",
      });
    }
    return branch;
  }

  async branchExists(name: string): Promise<boolean> {
    const result = await this.runGit(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], {
      allowNonZeroExit: true,
    });

    if (result.exitCode === 0) {
      return true;
    }
    if (result.exitCode === 1) {
      return false;
    }

    throw this.toGitError("failed checking branch existence", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], result);
  }

  async createBranch(name: string): Promise<void> {
    await this.runGitStrict(["checkout", "-b", name]);
  }

  async mergeMainIntoCurrent(mainBranch: string, strategy: DriftStrategy = "merge-main"): Promise<MergeResult> {
    const mergeArgs =
      strategy === "rebase-main" ? ["rebase", mainBranch] : ["merge", "--no-ff", "--no-edit", mainBranch];
    const result = await this.runGit(mergeArgs, { allowNonZeroExit: true });

    if (result.exitCode === 0) {
      const combinedOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();
      if (combinedOutput.includes("already up to date") || combinedOutput.includes("is up to date")) {
        return {
          status: "up_to_date",
          message: "Already up to date.",
        };
      }
      return {
        status: "merged",
        message: normalizedMessage(result),
      };
    }

    const conflictFiles = await this.detectConflictFiles();
    if (conflictFiles.length > 0) {
      return {
        status: "conflict",
        conflictFiles,
        message: normalizedMessage(result),
      };
    }

    return {
      status: "failed",
      message: normalizedMessage(result),
    };
  }

  async isMainDrifted(mainBranch: string): Promise<boolean> {
    const result = await this.runGitStrict(["rev-list", "--left-right", "--count", `HEAD...${mainBranch}`]);
    const [aheadCount, behindCount] = parseLeftRightCounts(result.stdout);
    return behindCount > 0 || aheadCount > 0;
  }

  async listDriftPaths(mainBranch: string): Promise<string[]> {
    const args = ["diff", "--name-only", "--diff-filter=ACMRTUXB", `HEAD...${mainBranch}`];
    const result = await this.runGit(args, {
      allowNonZeroExit: true,
    });

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw this.toGitError("failed to list drift paths", args, result);
    }

    return [...new Set(result.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0))].sort((left, right) => left.localeCompare(right));
  }

  async headSha(branch: string): Promise<string> {
    const result = await this.runGitStrict(["rev-parse", branch]);
    const sha = result.stdout.trim();
    if (sha.length === 0) {
      throw new SpecforgeError("GIT_ADAPTER_ERROR", `unable to resolve head sha for branch '${branch}'`, {
        branch,
      });
    }
    return sha;
  }

  async detectConflictFiles(): Promise<string[]> {
    const result = await this.runGit(["diff", "--name-only", "--diff-filter=U"], {
      allowNonZeroExit: true,
    });

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw this.toGitError("failed to detect merge conflicts", ["diff", "--name-only", "--diff-filter=U"], result);
    }

    return result.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .sort();
  }

  async markConflictFilesResolved(files: readonly string[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    await this.runGitStrict(["add", "--", ...files]);
  }

  async continueMerge(message?: string): Promise<void> {
    if (await this.hasGitRef("REBASE_HEAD")) {
      await this.runGitStrict(["rebase", "--continue"]);
      return;
    }

    if (message !== undefined && message.trim().length > 0) {
      await this.runGitStrict(["commit", "-m", message]);
      return;
    }
    await this.runGitStrict(["commit", "--no-edit"]);
  }

  async abortMerge(): Promise<void> {
    if (await this.hasGitRef("REBASE_HEAD")) {
      const rebaseAbortResult = await this.runGit(["rebase", "--abort"], { allowNonZeroExit: true });
      if (rebaseAbortResult.exitCode !== 0) {
        throw this.toGitError("failed to abort rebase", ["rebase", "--abort"], rebaseAbortResult);
      }
      return;
    }

    const result = await this.runGit(["merge", "--abort"], { allowNonZeroExit: true });
    if (result.exitCode !== 0) {
      throw this.toGitError("failed to abort merge", ["merge", "--abort"], result);
    }
  }

  private async hasGitRef(referenceName: string): Promise<boolean> {
    const result = await this.runGit(["rev-parse", "--verify", referenceName], {
      allowNonZeroExit: true,
    });

    return result.exitCode === 0;
  }

  private async runGit(
    args: string[],
    options?: {
      allowNonZeroExit?: boolean;
    },
  ): Promise<GitCommandResult> {
    try {
      const result = await execFile(this.gitBinary, args, {
        cwd: this.repoRoot,
        env: this.env,
        timeout: this.timeoutMs,
        maxBuffer: this.maxBufferBytes,
        encoding: "utf8",
      });

      return {
        stdout: (result.stdout as string).trimEnd(),
        stderr: (result.stderr as string).trimEnd(),
        exitCode: 0,
      };
    } catch (error) {
      const normalized = normalizeExecFileError(error);

      if (options?.allowNonZeroExit && normalized.exitCode >= 0) {
        return normalized;
      }

      throw this.toGitError("git command failed", args, normalized);
    }
  }

  private async runGitStrict(args: string[]): Promise<GitCommandResult> {
    return this.runGit(args);
  }

  private toGitError(message: string, commandArgs: string[], result: GitCommandResult): SpecforgeError {
    const sanitizedCommandArgs = commandArgs.map((value) => sanitizeOutput(value));

    return new SpecforgeError("GIT_ADAPTER_ERROR", `${message}: git command failed`, {
      repoRoot: this.repoRoot,
      command: [this.gitBinary, ...sanitizedCommandArgs],
      exitCode: result.exitCode,
      stdout: sanitizeOutput(result.stdout),
      stderr: sanitizeOutput(result.stderr),
    });
  }
}

function parseLeftRightCounts(output: string): [number, number] {
  const parts = output.trim().split(/\s+/);
  const ahead = Number.parseInt(parts[0] ?? "0", 10);
  const behind = Number.parseInt(parts[1] ?? "0", 10);

  return [
    Number.isFinite(ahead) ? ahead : 0,
    Number.isFinite(behind) ? behind : 0,
  ];
}

function normalizedMessage(result: GitCommandResult): string {
  const combined = [result.stdout, result.stderr].filter((value) => value.length > 0).join("\n").trim();
  return combined.length > 0 ? combined : `git exited with status ${result.exitCode}`;
}

function normalizeExecFileError(error: unknown): GitCommandResult {
  const fallback: GitCommandResult = {
    stdout: "",
    stderr: error instanceof Error ? error.message : "unknown error",
    exitCode: -1,
  };

  if (!(error instanceof Error)) {
    return fallback;
  }

  const execError = error as ExecFileException & {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };

  const code = execError.code;
  const exitCode = typeof code === "number" ? code : -1;
  return {
    stdout: bufferToString(execError.stdout),
    stderr: bufferToString(execError.stderr) || execError.message,
    exitCode,
  };
}

function bufferToString(value: string | Buffer | undefined): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trimEnd();
  }
  return value.toString("utf8").trimEnd();
}

function sanitizeOutput(value: string): string {
  return value
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9]{16,}\b/g, "[REDACTED]")
    .replace(/(https?:\/\/)([^\s:@]+):([^\s@]+)@/gi, "$1[REDACTED]@")
    .slice(0, 4000);
}
