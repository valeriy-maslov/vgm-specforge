import type { WorkType, WorkflowRun, WorkflowRunKey } from "@specforge/contracts";
import { isActiveWorkflowState } from "../state-machine/states.js";

const DEFAULT_BRANCH_NAMING_PATTERN = "sf/{workType}/{slug}";

export function workflowRunIdentity(key: WorkflowRunKey): string {
  return `${key.branchName}::${key.startedAt}`;
}

export function hasActiveWorkflowOnBranch(args: {
  branchName: string;
  runs: readonly WorkflowRun[];
}): boolean {
  return args.runs.some(
    (run) => run.key.branchName === args.branchName && isActiveWorkflowState(run.state),
  );
}

export function canStartWorkflowOnBranch(args: {
  branchName: string;
  runs: readonly WorkflowRun[];
}): { allowed: boolean; message?: string } {
  if (hasActiveWorkflowOnBranch(args)) {
    return {
      allowed: false,
      message: `branch '${args.branchName}' already has an active workflow`,
    };
  }
  return { allowed: true };
}

export function sanitizeBranchSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  return normalized.length > 0 ? normalized : "work";
}

export function renderBranchName(args: {
  pattern: string;
  workType: WorkType;
  slug: string;
}): string {
  const normalizedSlug = sanitizeBranchSlug(args.slug);
  const pattern = args.pattern.trim().length > 0 ? args.pattern : DEFAULT_BRANCH_NAMING_PATTERN;
  const rendered = pattern
    .replaceAll("{workType}", args.workType)
    .replaceAll("{slug}", normalizedSlug)
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (rendered.length > 0) {
    return rendered;
  }
  return `sf/${args.workType}/${normalizedSlug}`;
}

export function generateWorkflowBranchName(args: {
  workType: WorkType;
  slug: string;
  existingBranches: readonly string[];
  branchNamingPattern?: string;
}): string {
  const branchSet = new Set(args.existingBranches);
  const baseName = renderBranchName({
    pattern: args.branchNamingPattern ?? DEFAULT_BRANCH_NAMING_PATTERN,
    workType: args.workType,
    slug: args.slug,
  });

  if (!branchSet.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  let candidate = `${baseName}-${suffix}`;
  while (branchSet.has(candidate)) {
    suffix += 1;
    candidate = `${baseName}-${suffix}`;
  }

  return candidate;
}
