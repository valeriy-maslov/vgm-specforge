import type { CliResult } from "@specforge/contracts";
import {
  findCommandAction,
  findCommandGroup,
  renderGlobalHelp,
  renderGroupHelp,
} from "../commands/registry.js";
import { executeConfig } from "../commands/config.js";
import { executeAudit } from "../commands/audit.js";
import { executeComplete } from "../commands/complete.js";
import { executeDrift } from "../commands/drift.js";
import { executeInit } from "../commands/init.js";
import { executePlan } from "../commands/plan.js";
import { executeScope } from "../commands/scope.js";
import { executeSpec } from "../commands/spec.js";
import { executeSystemUpdate } from "../commands/system.js";
import { executeValidate } from "../commands/validate.js";
import { executeWorkflow } from "../commands/workflow.js";
import { formatHumanResult } from "../output/human.js";
import { errorResult, okResult, serializeJsonResult, unknownErrorResult } from "../output/json.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface RunCliOptions {
  cwd?: string;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = defaultIo(),
  options: RunCliOptions = {},
): Promise<number> {
  const runtimeCwd = options.cwd ?? process.cwd();
  const parsed = parseGlobalArgs(argv);

  if (parsed.positionals.length === 0) {
    return writeHelp(parsed, renderGlobalHelp(), io);
  }

  const commandName = parsed.positionals[0] as string;
  const commandGroup = findCommandGroup(commandName);
  if (commandGroup === undefined) {
    return writeResult(
      parsed,
      errorResult("UNKNOWN_COMMAND", `unknown command '${commandName}'`, {
        command: commandName,
      }),
      io,
    );
  }

  if (parsed.helpRequested && parsed.positionals.length === 1) {
    return writeHelp(parsed, renderGroupHelp(commandGroup), io);
  }

  const rawAction = parsed.positionals[1] as string | undefined;
  const hasExplicitAction = rawAction !== undefined && !rawAction.startsWith("-");
  const actionName = hasExplicitAction ? rawAction : commandGroup.defaultAction;
  if (actionName === undefined) {
    return writeResult(
      parsed,
      errorResult("MISSING_ACTION", `command '${commandGroup.name}' requires an action`, {
        command: commandGroup.name,
      }),
      io,
    );
  }

  const action = findCommandAction(commandGroup, actionName);
  if (action === undefined) {
    return writeResult(
      parsed,
      errorResult("UNKNOWN_ACTION", `unknown action '${actionName}' for command '${commandGroup.name}'`, {
        command: commandGroup.name,
        action: actionName,
      }),
      io,
    );
  }

  if (parsed.helpRequested) {
    return writeHelp(parsed, renderGroupHelp(commandGroup), io);
  }

  const argsOffset = hasExplicitAction ? 2 : 1;
  const actionArgs = parsed.positionals.slice(argsOffset);

  try {
    const result = await executeCommand(commandGroup.name, action.name, actionArgs, {
      cwd: runtimeCwd,
    });
    return writeResult(parsed, result, io);
  } catch (error) {
    return writeResult(parsed, unknownErrorResult(error), io);
  }
}

interface ParsedGlobalArgs {
  jsonRequested: boolean;
  helpRequested: boolean;
  positionals: string[];
}

function parseGlobalArgs(argv: readonly string[]): ParsedGlobalArgs {
  let jsonRequested = false;
  let helpRequested = false;
  const positionals: string[] = [];

  for (const value of argv) {
    if (value === "--json") {
      jsonRequested = true;
      continue;
    }
    if (value === "--help" || value === "-h") {
      helpRequested = true;
      continue;
    }

    positionals.push(value);
  }

  return {
    jsonRequested,
    helpRequested,
    positionals,
  };
}

async function executeCommand(
  command: string,
  action: string,
  args: string[],
  options: {
    cwd: string;
  },
): Promise<CliResult<unknown>> {
  if (command === "init" && action === "run") {
    return executeInit(args, {
      cwd: options.cwd,
    });
  }

  if (command === "config" && (action === "get" || action === "set")) {
    return executeConfig(action, args, {
      cwd: options.cwd,
    });
  }

  if (command === "system" && action === "update") {
    return executeSystemUpdate(args, {
      cwd: options.cwd,
    });
  }

  if (command === "workflow" && (action === "start" || action === "status" || action === "cancel")) {
    return executeWorkflow(action, args, {
      cwd: options.cwd,
    });
  }

  if (command === "scope" && (action === "analyze" || action === "confirm")) {
    return executeScope(action, args, {
      cwd: options.cwd,
    });
  }

  if (command === "spec" && (action === "draft" || action === "approve")) {
    return executeSpec(action, args, {
      cwd: options.cwd,
    });
  }

  if (command === "plan" && (action === "draft" || action === "approve")) {
    return executePlan(action, args, {
      cwd: options.cwd,
    });
  }

  if (command === "validate" && (action === "run" || action === "decide")) {
    return executeValidate(action, args, {
      cwd: options.cwd,
    });
  }

  if (command === "complete" && (action === "preview" || action === "approve" || action === "sync" || action === "force")) {
    return executeComplete(action, args, {
      cwd: options.cwd,
    });
  }

  if (command === "audit" && action === "query") {
    return executeAudit(args, {
      cwd: options.cwd,
    });
  }

  if (command === "drift" && (action === "check" || action === "merge-main" || action === "resolve")) {
    return executeDrift(action, args, {
      cwd: options.cwd,
    });
  }

  return errorResult("NOT_IMPLEMENTED", `command '${command} ${action}' is not implemented yet`, {
    command,
    action,
    args,
  });
}

function writeHelp(parsed: ParsedGlobalArgs, helpText: string, io: CliIo): number {
  if (parsed.jsonRequested) {
    io.stdout(
      serializeJsonResult(
        okResult({
          help: helpText,
        }),
      ),
    );
    return 0;
  }

  io.stdout(`${helpText}\n`);
  return 0;
}

function writeResult(parsed: ParsedGlobalArgs, result: CliResult<unknown>, io: CliIo): number {
  if (parsed.jsonRequested) {
    io.stdout(serializeJsonResult(result));
  } else if (result.ok) {
    io.stdout(formatHumanResult(result));
  } else {
    io.stderr(formatHumanResult(result));
  }

  return result.ok ? 0 : 1;
}

function defaultIo(): CliIo {
  return {
    stdout: (text: string) => {
      process.stdout.write(text);
    },
    stderr: (text: string) => {
      process.stderr.write(text);
    },
  };
}
