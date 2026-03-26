import { createCommandContext } from "@specforge/application";
import type { CliResult, PlanApproveOutput, PlanDraftOutput } from "@specforge/contracts";
import { okResult } from "../output/json.js";
import { createRuntimeServices } from "../composition/runtime-services.js";
import { invalidArguments, parseCommonCommandOptions, parseRequiredRunKey } from "./shared.js";

export interface ExecutePlanOptions {
  cwd: string;
}

export async function executePlan(
  action: "draft" | "approve",
  args: readonly string[],
  options: ExecutePlanOptions,
): Promise<CliResult<PlanDraftOutput | PlanApproveOutput>> {
  const common = parseCommonCommandOptions(args, options.cwd);
  if (!common.ok) {
    return common.result;
  }

  if (action === "draft") {
    const parsed = parseDraft(common.value.rest);
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

      const output = await runtime.planService.draft(parsed.input, context);
      return okResult(output);
    } finally {
      await runtime.close();
    }
  }

  const parsed = parseApprove(common.value.rest);
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

    const output = await runtime.planService.approve(parsed.input, context);
    return okResult(output);
  } finally {
    await runtime.close();
  }
}

function parseDraft(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run: {
          branchName: string;
          startedAt: string;
        };
        instructions?: string;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let branchName: string | undefined;
  let startedAt: string | undefined;
  let instructions: string | undefined;

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
    if (token === "--instructions") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--instructions requires a value");
      }
      instructions = value;
      index += 1;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for plan draft`);
  }

  const runKey = parseRequiredRunKey(branchName, startedAt);
  if (!runKey.ok) {
    return runKey;
  }

  return {
    ok: true,
    input: {
      run: runKey.value,
      ...(instructions !== undefined
        ? {
            instructions,
          }
        : {}),
    },
  };
}

function parseApprove(
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

    return invalidArguments(`unknown option '${token}' for plan approve`);
  }

  const runKey = parseRequiredRunKey(branchName, startedAt);
  if (!runKey.ok) {
    return runKey;
  }

  if (approved === undefined) {
    return invalidArguments("plan approve requires either --approved or --rejected");
  }
  if (approvedFlag && rejectedFlag) {
    return invalidArguments("plan approve options --approved and --rejected are mutually exclusive");
  }

  return {
    ok: true,
    input: {
      run: runKey.value,
      approved,
    },
  };
}
