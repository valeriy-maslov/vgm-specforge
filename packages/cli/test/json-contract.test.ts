import { describe, expect, it } from "vitest";
import { runCli } from "../src/bin/run-cli.js";
import { COMMAND_GROUPS } from "../src/commands/registry.js";

describe("CLI JSON contract", () => {
  it("returns a JSON help envelope for every command group", async () => {
    for (const group of COMMAND_GROUPS) {
      const output = captureIo();
      const code = await runCli([group.name, "--help", "--json"], output.io);

      expect(code).toBe(0);
      const parsed = JSON.parse(output.stdout.join("")) as {
        ok: boolean;
        data: {
          help: string;
        };
      };

      expect(parsed.ok).toBe(true);
      expect(typeof parsed.data.help).toBe("string");
      expect(parsed.data.help.length).toBeGreaterThan(0);
    }
  });

  it("returns a JSON error envelope for unknown command", async () => {
    const output = captureIo();
    const code = await runCli(["unknown-command", "--json"], output.io);

    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdout.join("")) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("UNKNOWN_COMMAND");
    expect(typeof parsed.error.message).toBe("string");
  });
});

function captureIo(): {
  io: {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
  };
  stdout: string[];
  stderr: string[];
} {
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
