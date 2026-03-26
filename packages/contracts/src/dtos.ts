import type { AuditEvent } from "./events.js";
import type {
  AuditQuery,
  InitializationFinding,
  InitializationScanSummary,
  MergeResult,
  SyncPreview,
  SyncResult,
} from "./ports.js";
import type { RuleSourceName } from "./rules.js";
import type { ValidationDecision, WorkType, WorkflowRun, WorkflowRunKey, WorkflowState } from "./workflow.js";

export type CliResult<TData> =
  | { ok: true; data: TData; warnings?: string[] }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
    };

export interface InitCommandInput {
  mode: "new" | "existing";
  projectName?: string;
  promptContext?: string;
  approved?: boolean;
}

export interface InitCommandOutput {
  initialized: boolean;
  mode: "new" | "existing";
  generatedArtifacts: string[];
  createdArtifacts: string[];
  updatedArtifacts: string[];
  reconciliationRequired: boolean;
  reconciliationFindings: InitializationFinding[];
  reconciliationReportPath?: string;
  scanSummary: InitializationScanSummary;
  pendingBundledApproval: boolean;
}

export interface SystemUpdateInput {
  dryRun?: boolean;
}

export interface SystemUpdateOutput {
  updatedFiles: string[];
  skippedFiles: string[];
  removedFiles: string[];
}

export interface ConfigGetInput {
  key?: string;
}

export interface ConfigGetOutput {
  value: unknown;
}

export interface ConfigSetInput {
  key: string;
  value: unknown;
}

export interface ConfigSetOutput {
  key: string;
  previousValue: unknown;
  currentValue: unknown;
}

export interface StartWorkflowInput {
  title: string;
  prompt: string;
  requestedWorkType?: WorkType;
  branchName?: string;
}

export interface StartWorkflowOutput {
  started: boolean;
  run?: WorkflowRun;
  message?: string;
}

export interface WorkflowStatusInput {
  run?: WorkflowRunKey;
  branchName?: string;
}

export interface WorkflowStatusOutput {
  run: WorkflowRun | null;
  active: boolean;
}

export interface WorkflowCancelInput {
  run: WorkflowRunKey;
  reason: string;
}

export interface WorkflowCancelOutput {
  cancelled: boolean;
  run: WorkflowRun;
}

export interface ScopeAnalyzeInput {
  run: WorkflowRunKey;
  strictSectionIds?: string[];
  freeText?: string;
}

export interface ScopeAnalyzeOutput {
  proposedSectionIds: string[];
  affectedAreas: string[];
}

export interface ScopeConfirmInput {
  run: WorkflowRunKey;
  sectionIds: string[];
}

export interface ScopeConfirmOutput {
  confirmedSectionIds: string[];
  state: WorkflowState;
}

export interface SpecDraftInput {
  run: WorkflowRunKey;
  instructions?: string;
}

export interface SpecDraftOutput {
  state: WorkflowState;
  draftPath: string;
}

export interface SpecApproveInput {
  run: WorkflowRunKey;
  approved: boolean;
}

export interface SpecApproveOutput {
  state: WorkflowState;
  approved: boolean;
  appliedRuleSources: RuleSourceName[];
}

export interface PlanDraftInput {
  run: WorkflowRunKey;
  instructions?: string;
}

export interface PlanDraftOutput {
  state: WorkflowState;
  draftPath: string;
}

export interface PlanApproveInput {
  run: WorkflowRunKey;
  approved: boolean;
}

export interface PlanApproveOutput {
  state: WorkflowState;
  approved: boolean;
  appliedRuleSources: RuleSourceName[];
}

export interface ValidationRunInput {
  run: WorkflowRunKey;
  mainBranch?: string;
  approveDriftAnalysis?: boolean;
}

export interface ValidationRunOutput {
  checksRun: string[];
  failedChecks: string[];
  state: WorkflowState;
}

export interface ValidationDecideInput {
  run: WorkflowRunKey;
  decision: ValidationDecision;
  approved: boolean;
  unresolvedFailedGates: string[];
}

export interface ValidationDecideOutput {
  state: WorkflowState;
  decision: ValidationDecision;
}

export interface CompletionPreviewInput {
  run: WorkflowRunKey;
}

export interface CompletionPreviewOutput {
  preview: SyncPreview;
}

export interface CompletionApproveInput {
  run: WorkflowRunKey;
  approved: boolean;
}

export interface CompletionApproveOutput {
  state: WorkflowState;
  approved: boolean;
}

export interface CompletionSyncInput {
  run: WorkflowRunKey;
  mainBranch?: string;
  approveDriftAnalysis?: boolean;
  requestPullRequest?: boolean;
  pullRequestTitle?: string;
  pullRequestBody?: string;
}

export interface CompletionSyncOutput {
  state: WorkflowState;
  result: SyncResult;
  pullRequest?: {
    requested: boolean;
    created: boolean;
    url?: string;
    message?: string;
  };
}

export interface ForceCompletionInput {
  run: WorkflowRunKey;
  reason: string;
  approvedBy: string;
}

export interface ForceCompletionOutput {
  requested: boolean;
  state: WorkflowState;
}

export interface DriftCheckInput {
  run: WorkflowRunKey;
  mainBranch: string;
}

export interface DriftCheckOutput {
  drifted: boolean;
}

export interface DriftMergeMainInput {
  run: WorkflowRunKey;
  mainBranch: string;
}

export interface DriftMergeMainOutput {
  result: MergeResult;
  proposal?: {
    resolutionPlan: string;
    conflictFiles: string[];
  };
}

export interface DriftResolveInput {
  run: WorkflowRunKey;
  approved: boolean;
  resolutionPlan?: string;
}

export interface DriftResolveOutput {
  resolved: boolean;
  resolutionPlan: string;
}

export interface AuditQueryInput extends AuditQuery {}

export interface AuditQueryOutput {
  events: AuditEvent[];
}
