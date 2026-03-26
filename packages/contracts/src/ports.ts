import type { AuditEvent, DomainEventName, HardGateRuleAuditPayload } from "./events.js";
import type { DriftStrategy } from "./rules.js";
import type { WorkflowRun, WorkflowRunKey } from "./workflow.js";

export interface AuditQuery {
  run?: WorkflowRunKey;
  branchName?: string;
  eventTypes?: DomainEventName[];
  fromIso?: string;
  toIso?: string;
  limit?: number;
}

export interface DocRef {
  path: string;
}

export interface DocContent {
  ref: DocRef;
  body: string;
}

export type SyncOperationKind = "create" | "update" | "delete";

export interface SyncOperation {
  kind: SyncOperationKind;
  path: string;
  description: string;
  beforeHash?: string;
  afterHash?: string;
}

export interface SyncChangeSet {
  run: WorkflowRunKey;
  operations: SyncOperation[];
  metadata?: Record<string, unknown>;
}

export interface SyncPreview {
  run: WorkflowRunKey;
  operations: SyncOperation[];
  warnings: string[];
  forceCompletionContext?: {
    explicitCommand: string;
    reason: string;
    overriddenFailedGates: string[];
    riskAcceptance: {
      acceptedBy: string;
      acceptedAt: string | null;
    };
  };
}

export interface SyncResult {
  run: WorkflowRunKey;
  success: boolean;
  appliedOperations: SyncOperation[];
  message?: string;
}

export interface SystemAssetsUpdateInput {
  dryRun?: boolean;
}

export interface SystemAssetsUpdateResult {
  updatedFiles: string[];
  skippedFiles: string[];
  removedFiles: string[];
}

export interface PullRequestCreateInput {
  branchName: string;
  title: string;
  body?: string;
}

export interface PullRequestCreateResult {
  url: string;
  number?: number;
}

export interface InitializationScanSummary {
  scannedAt: string;
  fileCount: number;
  sourceFileCount: number;
  markdownDocCount: number;
}

export interface InitializationFinding {
  code: string;
  message: string;
}

export interface InitializationBootstrapInput {
  projectRoot: string;
  mode: "new" | "existing";
  projectName?: string;
  promptContext?: string;
  nowIso: string;
}

export interface InitializationBootstrapOutput {
  generatedArtifacts: string[];
  createdArtifacts: string[];
  updatedArtifacts: string[];
  reconciliationRequired: boolean;
  reconciliationFindings: InitializationFinding[];
  reconciliationReportPath?: string;
  scanSummary: InitializationScanSummary;
}

export interface MergeResult {
  status: "merged" | "up_to_date" | "conflict" | "failed";
  conflictFiles?: string[];
  message?: string;
}

export interface AuditDriver {
  connect(config: unknown): Promise<void>;
  append(event: AuditEvent): Promise<void>;
  query(filter: AuditQuery): Promise<AuditEvent[]>;
  getRun(run: WorkflowRunKey): Promise<WorkflowRun | null>;
  saveRun(run: WorkflowRun): Promise<void>;
  close(): Promise<void>;
}

export interface MasterDocStore {
  load(ref: DocRef): Promise<DocContent>;
  planSync(changeSet: SyncChangeSet): Promise<SyncPreview>;
  applySync(changeSet: SyncChangeSet): Promise<SyncResult>;
}

export interface GitPort {
  currentBranch(): Promise<string>;
  branchExists(name: string): Promise<boolean>;
  createBranch(name: string): Promise<void>;
  mergeMainIntoCurrent(mainBranch: string, strategy?: DriftStrategy): Promise<MergeResult>;
  isMainDrifted(mainBranch: string): Promise<boolean>;
  listDriftPaths(mainBranch: string): Promise<string[]>;
  headSha(branch: string): Promise<string>;
  detectConflictFiles(): Promise<string[]>;
  markConflictFilesResolved(files: readonly string[]): Promise<void>;
  continueMerge(message?: string): Promise<void>;
  abortMerge(): Promise<void>;
}

export interface SystemAssetsPort {
  update(input: SystemAssetsUpdateInput): Promise<SystemAssetsUpdateResult>;
}

export interface PullRequestPort {
  create(input: PullRequestCreateInput): Promise<PullRequestCreateResult>;
}

export interface InitializationWorkspacePort {
  bootstrap(input: InitializationBootstrapInput): Promise<InitializationBootstrapOutput>;
}

export interface InitializationState {
  initialized: boolean;
  mode: "new" | "existing";
  approvedAt?: string;
  generatedArtifacts: string[];
  createdArtifacts?: string[];
  updatedArtifacts?: string[];
  reconciliationRequired: boolean;
  reconciliationFindings?: InitializationFinding[];
  reconciliationReportPath?: string;
  scanSummary?: InitializationScanSummary;
  pendingBundledApproval: boolean;
  lastBundledApprovalAudit?: HardGateRuleAuditPayload;
  lastBundledApprovalDecisionAt?: string;
}

export interface InitializationStore {
  load(projectRoot: string): Promise<InitializationState | null>;
  save(projectRoot: string, state: InitializationState): Promise<void>;
}

export interface ConfigStore {
  load(projectRoot: string): Promise<Record<string, unknown>>;
  save(projectRoot: string, config: Record<string, unknown>): Promise<void>;
}
