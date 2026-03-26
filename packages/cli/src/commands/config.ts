import { resolve } from "node:path";
import { createCommandContext, DefaultConfigService } from "@specforge/application";
import type { CliResult, ConfigGetOutput, ConfigSetOutput } from "@specforge/contracts";
import { LocalConfigStore } from "../composition/local-config-store.js";
import { errorResult, okResult } from "../output/json.js";

export interface ExecuteConfigOptions {
  cwd: string;
}

export async function executeConfig(
  action: "get" | "set",
  args: readonly string[],
  options: ExecuteConfigOptions,
): Promise<CliResult<ConfigGetOutput | ConfigSetOutput>> {
  const parsed = parseConfigArgs(action, args, options.cwd);
  if (!parsed.ok) {
    return parsed.result;
  }

  const configStore = new LocalConfigStore({
    projectRoot: parsed.projectRoot,
  });
  const service = new DefaultConfigService({
    configStore,
  });
  const context = createCommandContext({
    actor: { kind: "user" },
    cwd: options.cwd,
    projectRoot: parsed.projectRoot,
  });

  if (action === "get") {
    const output = await service.get(
      parsed.key === undefined
        ? {}
        : {
            key: parsed.key,
          },
      context,
    );
    return okResult(output);
  }

  if (parsed.key === undefined) {
    return invalidArguments("config set requires --key").result;
  }

  const output = await service.set(
    {
      key: parsed.key,
      value: parsed.value,
    },
    context,
  );
  return okResult(output);
}

function parseConfigArgs(
  action: "get" | "set",
  args: readonly string[],
  cwd: string,
):
  | {
      ok: true;
      projectRoot: string;
      key?: string;
      value: unknown;
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let projectRoot = resolve(cwd);
  let key: string | undefined;
  let rawValue: string | undefined;
  let parseJsonValue = false;

  const cursor = [...args];
  while (cursor.length > 0) {
    const token = cursor.shift() as string;

    if (token === "--project-root") {
      const value = cursor.shift();
      if (value === undefined) {
        return invalidArguments("--project-root requires a value");
      }
      projectRoot = resolve(cwd, value);
      continue;
    }

    if (token === "--key") {
      const value = cursor.shift();
      if (value === undefined) {
        return invalidArguments("--key requires a value");
      }
      key = value;
      continue;
    }

    if (token === "--value") {
      const value = cursor.shift();
      if (value === undefined) {
        return invalidArguments("--value requires a value");
      }
      rawValue = value;
      continue;
    }

    if (token === "--value-json") {
      parseJsonValue = true;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for config ${action}`);
  }

  if (action === "get") {
    return {
      ok: true,
      projectRoot,
      ...(key !== undefined
        ? {
            key,
          }
        : {}),
      value: undefined,
    };
  }

  if (key === undefined) {
    return invalidArguments("config set requires --key");
  }
  if (rawValue === undefined) {
    return invalidArguments("config set requires --value");
  }

  let value: unknown = rawValue;
  if (parseJsonValue) {
    try {
      value = JSON.parse(rawValue) as unknown;
    } catch (error) {
      return invalidArguments(
        `config set --value-json expects valid JSON: ${error instanceof Error ? error.message : "parse error"}`,
      );
    }
  }

  return {
    ok: true,
    projectRoot,
    key,
    value,
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
