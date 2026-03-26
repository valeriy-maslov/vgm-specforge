import { randomUUID } from "node:crypto";
import type { Actor, RuleSources, WorkflowRunKey } from "@specforge/contracts";

export interface CommandContext {
  actor: Actor;
  cwd: string;
  projectRoot: string;
  requestId: string;
  run?: WorkflowRunKey;
  ruleSources?: RuleSources;
}

export interface CreateCommandContextInput {
  cwd: string;
  projectRoot: string;
  actor?: Actor;
  requestId?: string;
  run?: WorkflowRunKey;
  ruleSources?: RuleSources;
}

function normalizePath(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (trimmed.length === 0) {
    return ".";
  }
  if (trimmed === "/") {
    return "/";
  }
  return trimmed.replace(/\/+$/, "");
}

export function createCommandContext(input: CreateCommandContextInput): CommandContext {
  const context: CommandContext = {
    actor: input.actor ?? { kind: "user" },
    cwd: normalizePath(input.cwd),
    projectRoot: normalizePath(input.projectRoot),
    requestId: input.requestId ?? randomUUID(),
  };

  if (input.run !== undefined) {
    context.run = input.run;
  }
  if (input.ruleSources !== undefined) {
    context.ruleSources = input.ruleSources;
  }

  return context;
}
