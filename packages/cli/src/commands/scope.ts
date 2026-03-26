import { createCommandContext } from "@specforge/application";
import type { CliResult, ScopeAnalyzeOutput, ScopeConfirmOutput } from "@specforge/contracts";
import { okResult } from "../output/json.js";
import { createRuntimeServices } from "../composition/runtime-services.js";
import { invalidArguments, parseCommonCommandOptions, parseRequiredRunKey } from "./shared.js";

export interface ExecuteScopeOptions {
  cwd: string;
}

export async function executeScope(
  action: "analyze" | "confirm",
  args: readonly string[],
  options: ExecuteScopeOptions,
): Promise<CliResult<ScopeAnalyzeOutput | ScopeConfirmOutput>> {
  const common = parseCommonCommandOptions(args, options.cwd);
  if (!common.ok) {
    return common.result;
  }

  if (action === "analyze") {
    const parsed = parseAnalyze(common.value.rest);
    if (!parsed.ok) {
      return parsed.result;
    }

    const runtime = await createRuntimeServices(common.value.projectRoot);
    try {
      const context = createCommandContext({
        actor: common.value.actor,
        cwd: options.cwd,
        projectRoot: common.value.projectRoot,
        ...(common.value.ruleSources !== undefined
          ? {
              ruleSources: common.value.ruleSources,
            }
          : {}),
      });

      const output = await runtime.scopeService.analyze(parsed.input, context);
      return okResult(output);
    } finally {
      await runtime.close();
    }
  }

  const parsed = parseConfirm(common.value.rest);
  if (!parsed.ok) {
    return parsed.result;
  }

  const runtime = await createRuntimeServices(common.value.projectRoot);
  try {
    const context = createCommandContext({
      actor: common.value.actor,
      cwd: options.cwd,
      projectRoot: common.value.projectRoot,
      ...(common.value.ruleSources !== undefined
        ? {
            ruleSources: common.value.ruleSources,
          }
        : {}),
    });

    const output = await runtime.scopeService.confirm(parsed.input, context);
    return okResult(output);
  } finally {
    await runtime.close();
  }
}

function parseAnalyze(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run: {
          branchName: string;
          startedAt: string;
        };
        strictSectionIds?: string[];
        freeText?: string;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let branchName: string | undefined;
  let startedAt: string | undefined;
  const strictSectionIds: string[] = [];
  let freeText: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string;
    if (token === "--branch") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--branch requires a value");
      }
      branchName = value;
      index += 1;
      continue;
    }
    if (token === "--started-at") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--started-at requires a value");
      }
      startedAt = value;
      index += 1;
      continue;
    }
    if (token === "--section") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--section requires a value");
      }
      strictSectionIds.push(value);
      index += 1;
      continue;
    }
    if (token === "--text") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--text requires a value");
      }
      freeText = value;
      index += 1;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for scope analyze`);
  }

  const runKey = parseRequiredRunKey(branchName, startedAt);
  if (!runKey.ok) {
    return runKey;
  }

  return {
    ok: true,
    input: {
      run: runKey.value,
      ...(strictSectionIds.length > 0
        ? {
            strictSectionIds,
          }
        : {}),
      ...(freeText !== undefined
        ? {
            freeText,
          }
        : {}),
    },
  };
}

function parseConfirm(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run: {
          branchName: string;
          startedAt: string;
        };
        sectionIds: string[];
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let branchName: string | undefined;
  let startedAt: string | undefined;
  const sectionIds: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string;
    if (token === "--branch") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--branch requires a value");
      }
      branchName = value;
      index += 1;
      continue;
    }
    if (token === "--started-at") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--started-at requires a value");
      }
      startedAt = value;
      index += 1;
      continue;
    }
    if (token === "--section") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--section requires a value");
      }
      sectionIds.push(value);
      index += 1;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for scope confirm`);
  }

  const runKey = parseRequiredRunKey(branchName, startedAt);
  if (!runKey.ok) {
    return runKey;
  }

  if (sectionIds.length === 0) {
    return invalidArguments("scope confirm requires at least one --section");
  }

  return {
    ok: true,
    input: {
      run: runKey.value,
      sectionIds,
    },
  };
}
