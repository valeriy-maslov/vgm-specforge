export interface CliCommandAction {
  name: string;
  description: string;
}

export interface CliCommandGroup {
  name: string;
  description: string;
  actions: readonly CliCommandAction[];
  defaultAction?: string;
}

export const COMMAND_GROUPS: readonly CliCommandGroup[] = [
  {
    name: "init",
    description: "Initialize SpecForge project foundation",
    actions: [
      {
        name: "run",
        description: "Run initialization flow",
      },
    ],
    defaultAction: "run",
  },
  {
    name: "system",
    description: "Manage SpecForge system assets",
    actions: [
      {
        name: "update",
        description: "Update managed prompts and skills",
      },
    ],
  },
  {
    name: "config",
    description: "Read and write project configuration",
    actions: [
      {
        name: "get",
        description: "Read one or all config values",
      },
      {
        name: "set",
        description: "Write a config value",
      },
    ],
  },
  {
    name: "workflow",
    description: "Start and inspect workflow lifecycle",
    actions: [
      {
        name: "start",
        description: "Start a workflow",
      },
      {
        name: "status",
        description: "Get workflow status",
      },
      {
        name: "cancel",
        description: "Cancel a workflow",
      },
    ],
  },
  {
    name: "scope",
    description: "Scope analysis and confirmation",
    actions: [
      {
        name: "analyze",
        description: "Propose affected sections",
      },
      {
        name: "confirm",
        description: "Confirm scope selection",
      },
    ],
  },
  {
    name: "spec",
    description: "Work spec drafting and approval",
    actions: [
      {
        name: "draft",
        description: "Draft a work spec",
      },
      {
        name: "approve",
        description: "Approve or reject spec",
      },
    ],
  },
  {
    name: "plan",
    description: "Implementation plan drafting and approval",
    actions: [
      {
        name: "draft",
        description: "Draft implementation plan",
      },
      {
        name: "approve",
        description: "Approve or reject plan",
      },
    ],
  },
  {
    name: "validate",
    description: "Run and decide validation",
    actions: [
      {
        name: "run",
        description: "Run validation checks",
      },
      {
        name: "decide",
        description: "Accept or request changes",
      },
    ],
  },
  {
    name: "complete",
    description: "Preview, approve, and sync completion",
    actions: [
      {
        name: "preview",
        description: "Generate completion sync preview",
      },
      {
        name: "approve",
        description: "Approve completion sync preview",
      },
      {
        name: "sync",
        description: "Apply atomic sync",
      },
      {
        name: "force",
        description: "Request force completion",
      },
    ],
  },
  {
    name: "drift",
    description: "Detect and resolve main branch drift",
    actions: [
      {
        name: "check",
        description: "Check drift against main",
      },
      {
        name: "merge-main",
        description: "Merge main into branch",
      },
      {
        name: "resolve",
        description: "Apply approved conflict resolution",
      },
    ],
  },
  {
    name: "audit",
    description: "Query workflow audit history",
    actions: [
      {
        name: "query",
        description: "Query workflow events",
      },
    ],
  },
] as const;

export function findCommandGroup(name: string): CliCommandGroup | undefined {
  return COMMAND_GROUPS.find((group) => group.name === name);
}

export function findCommandAction(group: CliCommandGroup, actionName: string): CliCommandAction | undefined {
  return group.actions.find((action) => action.name === actionName);
}

export function renderGlobalHelp(): string {
  const lines: string[] = [];
  lines.push("Usage: specforge <command> <action> [options]");
  lines.push("");
  lines.push("Commands:");

  for (const group of COMMAND_GROUPS) {
    lines.push(`  ${group.name.padEnd(10)} ${group.description}`);
  }

  lines.push("");
  lines.push("Global options:");
  lines.push("  --help, -h   Show help");
  lines.push("  --json       Emit JSON envelope output");
  lines.push("");
  lines.push("Run 'specforge <command> --help' for command details.");

  return lines.join("\n");
}

export function renderGroupHelp(group: CliCommandGroup): string {
  const lines: string[] = [];
  lines.push(`Usage: specforge ${group.name} <action> [options]`);
  lines.push("");
  lines.push(group.description);
  lines.push("");
  lines.push("Actions:");

  for (const action of group.actions) {
    lines.push(`  ${action.name.padEnd(14)} ${action.description}`);
  }

  if (group.defaultAction !== undefined) {
    lines.push("");
    lines.push(`Default action: ${group.defaultAction}`);
  }

  return lines.join("\n");
}
