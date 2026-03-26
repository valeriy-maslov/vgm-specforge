import { createCommandContext } from "@specforge/application";
import type { CliResult, ValidationDecideOutput, ValidationRunOutput, ValidationDecision } from "@specforge/contracts";
import { okResult } from "../output/json.js";
import { createRuntimeServices } from "../composition/runtime-services.js";
import { invalidArguments, parseCommonCommandOptions, parseRequiredRunKey } from "./shared.js";

export interface ExecuteValidateOptions {
  cwd: string;
}

export async function executeValidate(
  action: "run" | "decide",
  args: readonly string[],
  options: ExecuteValidateOptions,
): Promise<CliResult<ValidationRunOutput | ValidationDecideOutput>> {
  const common = parseCommonCommandOptions(args, options.cwd);
  if (!common.ok) {
    return common.result;
  }

  if (action === "run") {
    const parsed = parseRun(common.value.rest);
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

      const output = await runtime.validationService.run(parsed.input, context);
      return okResult(output);
    } finally {
      await runtime.close();
    }
  }

  const parsed = parseDecide(common.value.rest);
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

    const output = await runtime.validationService.decide(parsed.input, context);
    return okResult(output);
  } finally {
    await runtime.close();
  }
}

function parseRun(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run: {
          branchName: string;
          startedAt: string;
        };
        mainBranch?: string;
        approveDriftAnalysis?: boolean;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let branchName: string | undefined;
  let startedAt: string | undefined;
  let mainBranch = "main";
  let approveDriftAnalysis = false;

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
    if (token === "--approve-drift-analysis") {
      approveDriftAnalysis = true;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for validate run`);
  }

  const runKey = parseRequiredRunKey(branchName, startedAt);
  if (!runKey.ok) {
    return runKey;
  }

  return {
    ok: true,
    input: {
      run: runKey.value,
      ...(mainBranch !== "main"
        ? {
            mainBranch,
          }
        : {}),
      ...(approveDriftAnalysis
        ? {
            approveDriftAnalysis: true,
          }
        : {}),
    },
  };
}

function parseDecide(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run: {
          branchName: string;
          startedAt: string;
        };
        decision: ValidationDecision;
        approved: boolean;
        unresolvedFailedGates: string[];
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let branchName: string | undefined;
  let startedAt: string | undefined;
  let decision: ValidationDecision | undefined;
  let approved = true;
  let approvedFlag = false;
  let rejectedFlag = false;
  const unresolvedFailedGates: string[] = [];

  const assignDecision = (next: ValidationDecision): { ok: true } | { ok: false; result: CliResult<never> } => {
    if (decision !== undefined && decision !== next) {
      return invalidArguments("conflicting validation decision options provided");
    }
    decision = next;
    return { ok: true };
  };

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
    if (token === "--decision") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--decision requires a value");
      }
      if (value !== "accepted" && value !== "changes_requested") {
        return invalidArguments("--decision must be one of: accepted, changes_requested");
      }
      const assigned = assignDecision(value);
      if (!assigned.ok) {
        return assigned;
      }
      index += 1;
      continue;
    }
    if (token === "--accepted") {
      const assigned = assignDecision("accepted");
      if (!assigned.ok) {
        return assigned;
      }
      continue;
    }
    if (token === "--changes-requested") {
      const assigned = assignDecision("changes_requested");
      if (!assigned.ok) {
        return assigned;
      }
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
    if (token === "--unresolved-failed-gate") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--unresolved-failed-gate requires a value");
      }
      unresolvedFailedGates.push(value);
      index += 1;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for validate decide`);
  }

  const runKey = parseRequiredRunKey(branchName, startedAt);
  if (!runKey.ok) {
    return runKey;
  }
  if (decision === undefined) {
    return invalidArguments("validate decide requires --decision");
  }
  if (approvedFlag && rejectedFlag) {
    return invalidArguments("validate decide options --approved and --rejected are mutually exclusive");
  }

  return {
    ok: true,
    input: {
      run: runKey.value,
      decision,
      approved,
      unresolvedFailedGates,
    },
  };
}
