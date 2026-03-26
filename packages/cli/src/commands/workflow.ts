import { createCommandContext } from "@specforge/application";
import type { CliResult, StartWorkflowOutput, WorkflowCancelOutput, WorkflowStatusOutput, WorkType } from "@specforge/contracts";
import { okResult } from "../output/json.js";
import { createRuntimeServices } from "../composition/runtime-services.js";
import {
  invalidArguments,
  parseCommonCommandOptions,
  parseOptionalRunKey,
  parseRequiredRunKey,
} from "./shared.js";

export interface ExecuteWorkflowOptions {
  cwd: string;
}

export async function executeWorkflow(
  action: "start" | "status" | "cancel",
  args: readonly string[],
  options: ExecuteWorkflowOptions,
): Promise<CliResult<StartWorkflowOutput | WorkflowStatusOutput | WorkflowCancelOutput>> {
  const common = parseCommonCommandOptions(args, options.cwd);
  if (!common.ok) {
    return common.result;
  }

  const parsed = parseWorkflowAction(action, common.value.rest);
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

    if (action === "start") {
      const output = await runtime.workflowService.start(parsed.input, context);
      return okResult(output);
    }

    if (action === "status") {
      const output = await runtime.workflowService.status(parsed.input, context);
      return okResult(output);
    }

    const output = await runtime.workflowService.cancel(parsed.input, context);
    return okResult(output);
  } finally {
    await runtime.close();
  }
}

function parseWorkflowAction(
  action: "start" | "status" | "cancel",
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
  if (action === "start") {
    return parseStart(args);
  }

  if (action === "status") {
    return parseStatus(args);
  }

  return parseCancel(args);
}

function parseStart(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        title: string;
        prompt: string;
        requestedWorkType?: WorkType;
        branchName?: string;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let title: string | undefined;
  let prompt: string | undefined;
  let requestedWorkType: WorkType | undefined;
  let branchName: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string;
    if (token === "--title") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--title requires a value");
      }
      title = value;
      index += 1;
      continue;
    }
    if (token === "--prompt") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--prompt requires a value");
      }
      prompt = value;
      index += 1;
      continue;
    }
    if (token === "--work-type") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--work-type requires a value");
      }
      if (value !== "feature" && value !== "refinement" && value !== "refactor") {
        return invalidArguments("--work-type must be one of: feature, refinement, refactor");
      }
      requestedWorkType = value;
      index += 1;
      continue;
    }
    if (token === "--branch") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--branch requires a value");
      }
      branchName = value;
      index += 1;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for workflow start`);
  }

  if (title === undefined || title.trim().length === 0) {
    return invalidArguments("workflow start requires --title");
  }
  if (prompt === undefined || prompt.trim().length === 0) {
    return invalidArguments("workflow start requires --prompt");
  }

  return {
    ok: true,
    input: {
      title,
      prompt,
      ...(requestedWorkType !== undefined
        ? {
            requestedWorkType,
          }
        : {}),
      ...(branchName !== undefined
        ? {
            branchName,
          }
        : {}),
    },
  };
}

function parseStatus(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run?: {
          branchName: string;
          startedAt: string;
        };
        branchName?: string;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let branchName: string | undefined;
  let startedAt: string | undefined;

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

    return invalidArguments(`unknown option '${token}' for workflow status`);
  }

  const runKey = parseOptionalRunKey(branchName, startedAt);
  if (!runKey.ok) {
    return runKey;
  }

  return {
    ok: true,
    input:
      runKey.value !== undefined
        ? {
            run: runKey.value,
          }
        : branchName !== undefined
          ? {
              branchName,
            }
          : {},
  };
}

function parseCancel(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run: {
          branchName: string;
          startedAt: string;
        };
        reason: string;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let branchName: string | undefined;
  let startedAt: string | undefined;
  let reason: string | undefined;

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
    if (token === "--reason") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--reason requires a value");
      }
      reason = value;
      index += 1;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for workflow cancel`);
  }

  const runKey = parseRequiredRunKey(branchName, startedAt);
  if (!runKey.ok) {
    return runKey;
  }

  if (reason === undefined || reason.trim().length === 0) {
    return invalidArguments("workflow cancel requires --reason");
  }

  return {
    ok: true,
    input: {
      run: runKey.value,
      reason,
    },
  };
}
