import { resolve } from "node:path";
import { createCommandContext, DefaultInitService } from "@specforge/application";
import type { CliResult, InitCommandInput, InitCommandOutput } from "@specforge/contracts";
import { LocalInitializationStore } from "../composition/local-initialization-store.js";
import { LocalInitializationWorkspace } from "../composition/local-initialization-workspace.js";
import { errorResult, okResult } from "../output/json.js";

export interface ExecuteInitOptions {
  cwd: string;
}

export async function executeInit(
  args: readonly string[],
  options: ExecuteInitOptions,
): Promise<CliResult<InitCommandOutput>> {
  const parsed = parseInitArgs(args, options.cwd);
  if (!parsed.ok) {
    return parsed.result;
  }

  const initializationStore = new LocalInitializationStore({
    projectRoot: parsed.projectRoot,
  });
  const initializationWorkspace = new LocalInitializationWorkspace({
    projectRoot: parsed.projectRoot,
  });
  const service = new DefaultInitService({
    initializationStore,
    initializationWorkspace,
  });

  const context = createCommandContext({
    actor: { kind: "user" },
    cwd: options.cwd,
    projectRoot: parsed.projectRoot,
  });

  const output = await service.initialize(parsed.input, context);
  return okResult(output);
}

function parseInitArgs(
  args: readonly string[],
  cwd: string,
):
  | {
      ok: true;
      projectRoot: string;
      input: InitCommandInput;
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let mode: "new" | "existing" | undefined;
  let projectRoot = resolve(cwd);
  let projectName: string | undefined;
  let promptContext: string | undefined;
  let approved = false;

  const cursor = [...args];
  while (cursor.length > 0) {
    const token = cursor.shift() as string;

    if (token === "--mode") {
      const value = cursor.shift();
      if (value === undefined) {
        return invalidArguments("--mode requires a value");
      }
      if (value !== "new" && value !== "existing") {
        return invalidArguments("--mode must be either 'new' or 'existing'");
      }
      mode = value;
      continue;
    }

    if (token === "--project-root") {
      const value = cursor.shift();
      if (value === undefined) {
        return invalidArguments("--project-root requires a value");
      }
      projectRoot = resolve(cwd, value);
      continue;
    }

    if (token === "--project-name") {
      const value = cursor.shift();
      if (value === undefined) {
        return invalidArguments("--project-name requires a value");
      }
      projectName = value;
      continue;
    }

    if (token === "--prompt-context") {
      const value = cursor.shift();
      if (value === undefined) {
        return invalidArguments("--prompt-context requires a value");
      }
      promptContext = value;
      continue;
    }

    if (token === "--approved") {
      approved = true;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for init`);
  }

  if (mode === undefined) {
    return invalidArguments("--mode is required");
  }

  const input: InitCommandInput = {
    mode,
    ...(projectName !== undefined
      ? {
          projectName,
        }
      : {}),
    ...(promptContext !== undefined
      ? {
          promptContext,
        }
      : {}),
    ...(approved
      ? {
          approved: true,
        }
      : {}),
  };

  return {
    ok: true,
    projectRoot,
    input,
  };
}

function invalidArguments(message: string): {
  ok: false;
  result: CliResult<never>;
} {
  return {
    ok: false,
    result: errorResult("INVALID_ARGUMENTS", message),
  };
}
