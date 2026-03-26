import { createCommandContext } from "@specforge/application";
import type { CliResult, DriftCheckOutput, DriftMergeMainOutput, DriftResolveOutput } from "@specforge/contracts";
import { okResult } from "../output/json.js";
import { createRuntimeServices } from "../composition/runtime-services.js";
import { invalidArguments, parseCommonCommandOptions, parseRequiredRunKey } from "./shared.js";

export interface ExecuteDriftOptions {
  cwd: string;
}

export async function executeDrift(
  action: "check" | "merge-main" | "resolve",
  args: readonly string[],
  options: ExecuteDriftOptions,
): Promise<CliResult<DriftCheckOutput | DriftMergeMainOutput | DriftResolveOutput>> {
  const common = parseCommonCommandOptions(args, options.cwd);
  if (!common.ok) {
    return common.result;
  }

  const parsed = parseDriftAction(action, common.value.rest);
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

    if (action === "check") {
      const output = await runtime.driftService.check(parsed.input, context);
      return okResult(output);
    }

    if (action === "merge-main") {
      const output = await runtime.driftService.mergeMain(parsed.input, context);
      return okResult(output);
    }

    const output = await runtime.driftService.resolveConflicts(parsed.input, context);
    return okResult(output);
  } finally {
    await runtime.close();
  }
}

function parseDriftAction(
  action: "check" | "merge-main" | "resolve",
  args: readonly string[],
):
  | {
      ok: true;
      input: any;
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  if (action === "check") {
    return parseCheck(args);
  }
  if (action === "merge-main") {
    return parseMergeMain(args);
  }
  return parseResolve(args);
}

function parseCheck(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run: {
          branchName: string;
          startedAt: string;
        };
        mainBranch: string;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  return parseCheckOrMerge(args, "drift check");
}

function parseMergeMain(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run: {
          branchName: string;
          startedAt: string;
        };
        mainBranch: string;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  return parseCheckOrMerge(args, "drift merge-main");
}

function parseCheckOrMerge(
  args: readonly string[],
  commandName: string,
):
  | {
      ok: true;
      input: {
        run: {
          branchName: string;
          startedAt: string;
        };
        mainBranch: string;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let branchName: string | undefined;
  let startedAt: string | undefined;
  let mainBranch = "main";

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
    if (token === "--main-branch") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--main-branch requires a value");
      }
      mainBranch = value;
      index += 1;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for ${commandName}`);
  }

  const runKey = parseRequiredRunKey(branchName, startedAt);
  if (!runKey.ok) {
    return runKey;
  }

  return {
    ok: true,
    input: {
      run: runKey.value,
      mainBranch,
    },
  };
}

function parseResolve(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run: {
          branchName: string;
          startedAt: string;
        };
        approved: boolean;
        resolutionPlan?: string;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let branchName: string | undefined;
  let startedAt: string | undefined;
  let approved: boolean | undefined;
  let approvedFlag = false;
  let rejectedFlag = false;
  let resolutionPlan: string | undefined;

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
    if (token === "--approved") {
      approvedFlag = true;
      approved = true;
      continue;
    }
    if (token === "--rejected") {
      rejectedFlag = true;
      approved = false;
      continue;
    }
    if (token === "--resolution-plan") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--resolution-plan requires a value");
      }
      resolutionPlan = value;
      index += 1;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for drift resolve`);
  }

  const runKey = parseRequiredRunKey(branchName, startedAt);
  if (!runKey.ok) {
    return runKey;
  }

  if (approved === undefined) {
    return invalidArguments("drift resolve requires either --approved or --rejected");
  }
  if (approvedFlag && rejectedFlag) {
    return invalidArguments("drift resolve options --approved and --rejected are mutually exclusive");
  }
  return {
    ok: true,
    input: {
      run: runKey.value,
      approved,
      ...(resolutionPlan !== undefined && resolutionPlan.trim().length > 0
        ? {
            resolutionPlan,
          }
        : {}),
    },
  };
}
