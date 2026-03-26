import { resolve } from "node:path";
import type { Actor, CliResult, RuleSet, RuleSources, WorkflowRunKey } from "@specforge/contracts";
import { errorResult } from "../output/json.js";

export interface ParsedCommonCommandOptions {
  projectRoot: string;
  actor: Actor;
  ruleSources?: RuleSources;
  rest: string[];
}

export function parseCommonCommandOptions(
  args: readonly string[],
  cwd: string,
):
  | {
      ok: true;
      value: ParsedCommonCommandOptions;
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  let projectRoot = resolve(cwd);
  let actorKind: Actor["kind"] = "user";
  let actorId: string | undefined;
  let promptRules: RuleSet | undefined;
  const rest: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string;

    if (token === "--project-root") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--project-root requires a value");
      }
      projectRoot = resolve(cwd, value);
      index += 1;
      continue;
    }

    if (token === "--actor-kind") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--actor-kind requires a value");
      }
      if (value !== "user" && value !== "agent" && value !== "system") {
        return invalidArguments("--actor-kind must be one of: user, agent, system");
      }
      actorKind = value;
      index += 1;
      continue;
    }

    if (token === "--actor-id") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--actor-id requires a value");
      }
      actorId = value;
      index += 1;
      continue;
    }

    if (token === "--drift-strategy") {
      const value = args[index + 1];
      if (value === undefined) {
        return invalidArguments("--drift-strategy requires a value");
      }
      if (value !== "merge-main" && value !== "rebase-main") {
        return invalidArguments("--drift-strategy must be one of: merge-main, rebase-main");
      }
      promptRules = {
        ...(promptRules ?? {}),
        driftStrategy: value,
      };
      index += 1;
      continue;
    }

    rest.push(token);
  }

  return {
    ok: true,
    value: {
      projectRoot,
      actor:
        actorId === undefined
          ? {
              kind: actorKind,
            }
          : {
              kind: actorKind,
              id: actorId,
            },
      ...(promptRules !== undefined
        ? {
            ruleSources: {
              prompt: promptRules,
            },
          }
        : {}),
      rest,
    },
  };
}

export function parseRequiredRunKey(
  branchName: string | undefined,
  startedAt: string | undefined,
):
  | {
      ok: true;
      value: WorkflowRunKey;
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  if (branchName === undefined || startedAt === undefined) {
    return invalidArguments("--branch and --started-at are required");
  }

  return {
    ok: true,
    value: {
      branchName: branchName!,
      startedAt: startedAt!,
    },
  };
}

export function parseOptionalRunKey(
  branchName: string | undefined,
  startedAt: string | undefined,
):
  | {
      ok: true;
      value?: WorkflowRunKey;
    }
  | {
      ok: false;
      result: CliResult<never>;
    } {
  if (branchName === undefined && startedAt === undefined) {
    return {
      ok: true,
    };
  }

  if (startedAt !== undefined && branchName === undefined) {
    return invalidArguments("--started-at requires --branch");
  }

  if (branchName !== undefined && startedAt === undefined) {
    return {
      ok: true,
    };
  }

  return {
    ok: true,
    value: {
      branchName: branchName as string,
      startedAt: startedAt as string,
    },
  };
}

export function invalidArguments(message: string): {
  ok: false;
  result: CliResult<never>;
} {
  return {
    ok: false,
    result: errorResult("INVALID_ARGUMENTS", message),
  };
}
