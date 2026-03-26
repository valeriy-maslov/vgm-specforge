import type { Actor, WorkType, WorkflowState } from "@specforge/contracts";
import type { WorkflowRun } from "@specforge/contracts";

export interface CompletionRetentionDecision {
  retainArtifacts: boolean;
  mode: "history-only" | "keep-artifacts";
}

export function decideCompletionRetention(args: {
  keepArtifactsExplicitlyRequested: boolean;
  defaultKeepArtifacts?: boolean;
}): CompletionRetentionDecision {
  const retainArtifacts = args.keepArtifactsExplicitlyRequested || args.defaultKeepArtifacts === true;
  return {
    retainArtifacts,
    mode: retainArtifacts ? "keep-artifacts" : "history-only",
  };
}

export interface CancellationRetentionRecord {
  branch_name: string;
  work_type: WorkType;
  initiator: Actor;
  created_at: string;
  cancelled_at: string;
  cancellation_reason: string;
  last_state: WorkflowState;
  affected_section_ids: string[];
  branch_head_sha: string;
  branch_exists: boolean;
}

export function buildCancellationRetentionRecord(args: {
  run: WorkflowRun;
  initiator: Actor;
  cancelledAt: string;
  cancellationReason: string;
  branchHeadSha: string;
  branchExists: boolean;
}): CancellationRetentionRecord {
  return {
    branch_name: args.run.key.branchName,
    work_type: args.run.workType,
    initiator: args.initiator,
    created_at: args.run.createdAt,
    cancelled_at: args.cancelledAt,
    cancellation_reason: args.cancellationReason,
    last_state: args.run.state,
    affected_section_ids: [...args.run.affectedSectionIds],
    branch_head_sha: args.branchHeadSha,
    branch_exists: args.branchExists,
  };
}
