import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/bin/run-cli.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0, tempDirectories.length).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("runCli", () => {
  it("prints global help with no args", async () => {
    const output = captureIo();

    const code = await runCli([], output.io);

    expect(code).toBe(0);
    expect(output.stdout.join("")).toContain("Usage: specforge");
  });

  it("returns structured config error when command wiring is active but runtime is not configured", async () => {
    const output = captureIo();

    const code = await runCli(["workflow", "start", "--title", "Feature", "--prompt", "Implement", "--json"], output.io);

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("CONFIG_ERROR");
  });

  it("returns an unknown-command error for unsupported commands", async () => {
    const output = captureIo();

    const code = await runCli(["unknown"], output.io);

    expect(code).toBe(1);
    expect(output.stderr.join("")).toContain("UNKNOWN_COMMAND");
  });

  it("executes system update with JSON output", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-cli-project-"));
    const assetsDir = await mkdtemp(join(tmpdir(), "specforge-cli-assets-"));
    tempDirectories.push(projectRoot, assetsDir);

    const filePath = "prompts/start.md";
    const fileBody = "# Start\n";
    const checksum = createHash("sha256").update(fileBody).digest("hex");

    await mkdir(join(assetsDir, "prompts"), { recursive: true });
    await writeFile(join(assetsDir, filePath), fileBody, "utf8");
    await writeFile(
      join(assetsDir, "manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: "2026-03-26T20:00:00.000Z",
          files: [
            {
              path: filePath,
              sha256: checksum,
              bytes: Buffer.byteLength(fileBody),
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const output = captureIo();

    const code = await runCli(
      ["system", "update", "--assets-dir", assetsDir, "--project-root", projectRoot, "--json"],
      output.io,
      {
        cwd: projectRoot,
      },
    );

    expect(code).toBe(0);

    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      data: {
        updatedFiles: string[];
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.updatedFiles).toEqual(["prompts/start.md"]);

    const stored = await readFile(join(projectRoot, ".specforge/system/prompts/start.md"), "utf8");
    expect(stored).toBe(fileBody);
  });

  it("validates required system update options", async () => {
    const output = captureIo();

    const code = await runCli(["system", "update", "--json"], output.io);

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("--assets-dir is required");
  });

  it("executes init command and persists initialization state", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-cli-init-"));
    tempDirectories.push(projectRoot);

    const output = captureIo();
    const code = await runCli(["init", "--mode", "existing", "--approved", "--project-root", projectRoot, "--json"], output.io, {
      cwd: projectRoot,
    });

    expect(code).toBe(0);

    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      data: {
        initialized: boolean;
        mode: string;
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.initialized).toBe(true);
    expect(parsed.data.mode).toBe("existing");

    const storedState = JSON.parse(
      await readFile(join(projectRoot, ".specforge/state/initialization.json"), "utf8"),
    ) as {
      initialized: boolean;
      pendingBundledApproval: boolean;
      mode: string;
    };
    expect(storedState.initialized).toBe(true);
    expect(storedState.pendingBundledApproval).toBe(false);
    expect(storedState.mode).toBe("existing");
  });

  it("validates required init mode option", async () => {
    const output = captureIo();
    const code = await runCli(["init", "--json"], output.io);

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("--mode is required");
  });

  it("sets and gets config values", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "specforge-cli-config-"));
    tempDirectories.push(projectRoot);

    const setOutput = captureIo();
    const setCode = await runCli(
      ["config", "set", "--key", "audit.schema", "--value", "specforge", "--project-root", projectRoot, "--json"],
      setOutput.io,
      {
        cwd: projectRoot,
      },
    );

    expect(setCode).toBe(0);
    const setResult = JSON.parse(setOutput.stdout.join("")) as {
      ok: boolean;
      data: {
        key: string;
        currentValue: unknown;
      };
    };
    expect(setResult.ok).toBe(true);
    expect(setResult.data.key).toBe("audit.schema");
    expect(setResult.data.currentValue).toBe("specforge");

    const getOutput = captureIo();
    const getCode = await runCli(
      ["config", "get", "--key", "audit.schema", "--project-root", projectRoot, "--json"],
      getOutput.io,
      {
        cwd: projectRoot,
      },
    );

    expect(getCode).toBe(0);
    const getResult = JSON.parse(getOutput.stdout.join("")) as {
      ok: boolean;
      data: {
        value: unknown;
      };
    };
    expect(getResult.ok).toBe(true);
    expect(getResult.data.value).toBe("specforge");

    const stored = await readFile(join(projectRoot, ".specforge/config.yaml"), "utf8");
    expect(stored).toContain("\"schema\": \"specforge\"");
  });

  it("validates required run key options for spec approval", async () => {
    const output = captureIo();

    const code = await runCli(["spec", "approve", "--approved", "--json"], output.io);

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("--branch and --started-at are required");
  });

  it("rejects conflicting spec approval flags", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "spec",
        "approve",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--approved",
        "--rejected",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("mutually exclusive");
  });

  it("rejects conflicting plan approval flags", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "plan",
        "approve",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--approved",
        "--rejected",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("mutually exclusive");
  });

  it("rejects conflicting completion approval flags", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "complete",
        "approve",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--approved",
        "--rejected",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("mutually exclusive");
  });

  it("rejects conflicting drift resolution approval flags", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "drift",
        "resolve",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--approved",
        "--rejected",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("mutually exclusive");
  });

  it("accepts workflow status with branch only", async () => {
    const output = captureIo();

    const code = await runCli(["workflow", "status", "--branch", "sf/feature/x", "--json"], output.io);

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
      };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("CONFIG_ERROR");
  });

  it("validates audit query event type values", async () => {
    const output = captureIo();

    const code = await runCli(["audit", "query", "--event-type", "unknown_event", "--json"], output.io);

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("unknown domain event type");
  });

  it("allows drift resolve without explicit resolution plan", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "drift",
        "resolve",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--approved",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
      };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("CONFIG_ERROR");
  });

  it("requires --request-pr when pull request fields are provided", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "complete",
        "sync",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--pr-title",
        "My PR",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("--request-pr");
  });

  it("accepts validate decide alias flags for decision", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "validate",
        "decide",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--accepted",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("CONFIG_ERROR");
  });

  it("rejects conflicting validate decision options", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "validate",
        "decide",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--accepted",
        "--changes-requested",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("conflicting validation decision options");
  });

  it("rejects conflicting validation approval flags", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "validate",
        "decide",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--decision",
        "accepted",
        "--approved",
        "--rejected",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("mutually exclusive");
  });

  it("accepts validate run drift confirmation flags", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "validate",
        "run",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--main-branch",
        "trunk",
        "--approve-drift-analysis",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("CONFIG_ERROR");
  });

  it("validates main branch flag value for complete sync", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "complete",
        "sync",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--main-branch",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("--main-branch requires a value");
  });

  it("accepts drift strategy override flag", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "validate",
        "run",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--drift-strategy",
        "rebase-main",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("CONFIG_ERROR");
  });

  it("rejects invalid drift strategy override value", async () => {
    const output = captureIo();

    const code = await runCli(
      [
        "validate",
        "run",
        "--branch",
        "sf/feature/x",
        "--started-at",
        "2026-03-26T00:00:00.000Z",
        "--drift-strategy",
        "squash-main",
        "--json",
      ],
      output.io,
    );

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENTS");
    expect(parsed.error.message).toContain("--drift-strategy");
  });
});

function captureIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      stdout: (text: string) => {
        stdout.push(text);
      },
      stderr: (text: string) => {
        stderr.push(text);
      },
    },
    stdout,
    stderr,
  };
}
