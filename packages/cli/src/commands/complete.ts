import { createCommandContext } from "@specforge/application";
import type {
  CliResult,
  CompletionApproveOutput,
  CompletionPreviewOutput,
  CompletionSyncOutput,
  ForceCompletionOutput,
} from "@specforge/contracts";
import { okResult } from "../output/json.js";
import { createRuntimeServices } from "../composition/runtime-services.js";
import { invalidArguments, parseCommonCommandOptions, parseRequiredRunKey } from "./shared.js";

export interface ExecuteCompleteOptions {
  cwd: string;
}

export async function executeComplete(
  action: "preview" | "approve" | "sync" | "force",
  args: readonly string[],
  options: ExecuteCompleteOptions,
): Promise<CliResult<CompletionPreviewOutput | CompletionApproveOutput | CompletionSyncOutput | ForceCompletionOutput>> {
  const common = parseCommonCommandOptions(args, options.cwd);
  if (!common.ok) {
    return common.result;
  }

  const parsed = parseCompleteAction(action, common.value.rest);
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

    if (action === "preview") {
      const output = await runtime.completionService.preview(parsed.input, context);
      return okResult(output);
    }

    if (action === "approve") {
      const output = await runtime.completionService.approve(parsed.input, context);
      return okResult(output);
    }

    if (action === "sync") {
      const output = await runtime.completionService.sync(parsed.input, context);
      return okResult(output);
    }

    const output = await runtime.completionService.force(parsed.input, context);
    return okResult(output);
  } finally {
    await runtime.close();
  }
}

function parseCompleteAction(
  action: "preview" | "approve" | "sync" | "force",
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
  if (action === "preview") {
    return parsePreview(args);
  }
  if (action === "approve") {
    return parseApprove(args);
  }
  if (action === "sync") {
    return parseSync(args);
  }
  return parseForce(args);
}

function parsePreview(
  args: readonly string[],
):
  | {
      ok: true;
      input: {
        run: {
          branchName: string;
          startedAt: string;
        };
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  const run = parseRunOnly(args, "complete preview");
  if (!run.ok) {
    return run;
  }
  return {
    ok: true,
    input: {
      run: run.value,
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
  let approved: boolean | undefined;
  let approvedFlag = false;
  let rejectedFlag = false;
  const run = parseRunWithFlags(args, "complete approve", (token) => {
    if (token === "--approved") {
      approvedFlag = true;
      approved = true;
      return true;
    }
    if (token === "--rejected") {
      rejectedFlag = true;
      approved = false;
      return true;
    }
    return false;
  });
  if (!run.ok) {
    return run;
  }

  if (approved === undefined) {
    return invalidArguments("complete approve requires either --approved or --rejected");
  }
  if (approvedFlag && rejectedFlag) {
    return invalidArguments("complete approve options --approved and --rejected are mutually exclusive");
  }

  return {
    ok: true,
    input: {
      run: run.value,
      approved,
    },
  };
}

function parseSync(
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
        requestPullRequest?: boolean;
        pullRequestTitle?: string;
        pullRequestBody?: string;
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
  let requestPullRequest = false;
  let pullRequestTitle: string | undefined;
  let pullRequestBody: string | undefined;

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
    if (token === "--request-pr") {
      requestPullRequest = true;
      continue;
    }
    if (token === "--pr-title") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--pr-title requires a value");
      }
      pullRequestTitle = value;
      index += 1;
      continue;
    }
    if (token === "--pr-body") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--pr-body requires a value");
      }
      pullRequestBody = value;
      index += 1;
      continue;
    }

    return invalidArguments(`unknown option '${token}' for complete sync`);
  }

  const run = parseRequiredRunKey(branchName, startedAt);
  if (!run.ok) {
    return run;
  }

  if (!requestPullRequest && (pullRequestTitle !== undefined || pullRequestBody !== undefined)) {
    return invalidArguments("--pr-title/--pr-body require --request-pr");
  }

  return {
    ok: true,
    input: {
      run: run.value,
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
      ...(requestPullRequest
        ? {
            requestPullRequest: true,
          }
        : {}),
      ...(pullRequestTitle !== undefined
        ? {
            pullRequestTitle,
          }
        : {}),
      ...(pullRequestBody !== undefined
        ? {
            pullRequestBody,
          }
        : {}),
    },
  };
}

function parseForce(
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
        approvedBy: string;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let reason: string | undefined;
  let approvedBy = "user";

  const run = parseRunWithFlags(args, "complete force", (token, value) => {
    if (token === "--reason") {
      if (value === undefined) {
        return invalidArguments("--reason requires a value");
      }
      reason = value;
      return true;
    }
    if (token === "--approved-by") {
      if (value === undefined) {
        return invalidArguments("--approved-by requires a value");
      }
      approvedBy = value;
      return true;
    }
    return false;
  });

  if (!run.ok) {
    return run;
  }

  if (reason === undefined || reason.trim().length === 0) {
    return invalidArguments("complete force requires --reason");
  }

  return {
    ok: true,
    input: {
      run: run.value,
      reason,
      approvedBy,
    },
  };
}

function parseRunOnly(
  args: readonly string[],
  commandName: string,
):
  | {
      ok: true;
      value: {
        branchName: string;
        startedAt: string;
      };
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  return parseRunWithFlags(args, commandName, () => false);
}

function parseRunWithFlags(
  args: readonly string[],
  commandName: string,
  handleFlag: (
    token: string,
    value?: string,
  ) =>
    | boolean
    | {
        ok: false;
        result: CliResult<never>;
      },
):
  | {
      ok: true;
      value: {
        branchName: string;
        startedAt: string;
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

    const value = args[index + 1];
    const handled = handleFlag(token, value);
    if (typeof handled === "object") {
      return handled;
    }
    if (handled) {
      if (token === "--reason" || token === "--approved-by") {
        index += 1;
      }
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
    value: runKey.value,
  };
}
