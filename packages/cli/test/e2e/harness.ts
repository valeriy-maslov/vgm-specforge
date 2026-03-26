import { runCli } from "../../src/bin/run-cli.js";

export interface CliExecutionResult {
  code: number;
  stdout: string;
  stderr: string;
  json?: unknown;
}

export async function runCliJson(args: readonly string[], cwd: string): Promise<CliExecutionResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const code = await runCli([...args, "--json"], {
    stdout: (text: string) => {
      stdout.push(text);
    },
    stderr: (text: string) => {
      stderr.push(text);
    },
  }, {
    cwd,
  });

  const stdoutText = stdout.join("");
  const stderrText = stderr.join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdoutText);
  } catch {
    parsed = undefined;
  }

  return {
    code,
    stdout: stdoutText,
    stderr: stderrText,
    ...(parsed !== undefined
      ? {
          json: parsed,
        }
      : {}),
  };
}
