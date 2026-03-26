import type { WorkType, WorkflowRun, WorkflowRunKey } from "@specforge/contracts";

export interface CreateWorkflowRunInput {
  key: WorkflowRunKey;
  workType: WorkType;
  title: string;
  nowIso: string;
  affectedSectionIds?: string[];
}

export function createWorkflowRun(input: CreateWorkflowRunInput): WorkflowRun {
  return {
    key: input.key,
    workType: input.workType,
    state: "intake",
    title: input.title,
    affectedSectionIds: [...(input.affectedSectionIds ?? [])],
    unresolvedFailedGates: [],
    forceCompletionRequested: false,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };
}
