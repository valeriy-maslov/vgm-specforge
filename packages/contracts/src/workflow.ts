export const WORK_TYPES = ["feature", "refinement", "refactor"] as const;

export type WorkType = (typeof WORK_TYPES)[number];

export const WORKFLOW_STATES = [
  "intake",
  "scope_confirmed",
  "spec_drafting",
  "spec_approved",
  "plan_drafting",
  "plan_approved",
  "implementing",
  "validation",
  "rework",
  "ready_to_complete",
  "completed",
  "cancelled",
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const TERMINAL_WORKFLOW_STATES = ["completed", "cancelled"] as const;

export type TerminalWorkflowState = (typeof TERMINAL_WORKFLOW_STATES)[number];

export const HARD_GATES = [
  "initialization_bundled_approval",
  "spec_approval",
  "plan_approval",
  "validation_decision",
  "final_sync_preview_approval",
] as const;

export type HardGate = (typeof HARD_GATES)[number];

export type ValidationDecision = "accepted" | "changes_requested";

export interface Actor {
  kind: "user" | "agent" | "system";
  id?: string;
}

export interface WorkflowRunKey {
  branchName: string;
  startedAt: string;
}

export interface WorkflowRun {
  key: WorkflowRunKey;
  workType: WorkType;
  state: WorkflowState;
  title: string;
  affectedSectionIds: string[];
  unresolvedFailedGates: string[];
  forceCompletionRequested: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  metadata?: Record<string, unknown>;
}

export type DomainAction =
  | { type: "approve_initialization_bundle"; approved: boolean }
  | { type: "confirm_scope"; affectedSectionIds: string[] }
  | { type: "start_spec_drafting" }
  | { type: "approve_spec"; approved: boolean }
  | { type: "start_plan_drafting" }
  | { type: "approve_plan"; approved: boolean }
  | { type: "start_implementation" }
  | { type: "complete_implementation" }
  | {
      type: "validation_decision";
      decision: ValidationDecision;
      approved: boolean;
      unresolvedFailedGates: string[];
    }
  | { type: "apply_rework" }
  | { type: "approve_sync_preview"; approved: boolean }
  | { type: "request_sync_retry" }
  | { type: "request_force_completion"; reason: string; approvedBy: string }
  | { type: "sync_failed"; reason: string }
  | { type: "sync_succeeded" }
  | { type: "cancel_workflow"; reason: string };
