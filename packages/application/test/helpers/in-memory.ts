import type {
  AuditDriver,
  AuditEvent,
  AuditQuery,
  ConfigStore,
  GitPort,
  MasterDocStore,
  MergeResult,
  PullRequestCreateInput,
  PullRequestCreateResult,
  PullRequestPort,
  SystemAssetsPort,
  SystemAssetsUpdateInput,
  SystemAssetsUpdateResult,
  InitializationState,
  InitializationBootstrapInput,
  InitializationBootstrapOutput,
  InitializationStore,
  InitializationWorkspacePort,
  SyncChangeSet,
  SyncPreview,
  SyncResult,
  WorkflowRun,
  WorkflowRunKey,
} from "@specforge/contracts";

export class InMemoryAuditDriver implements AuditDriver {
  readonly runs = new Map<string, WorkflowRun>();

  readonly events: AuditEvent[] = [];

  async connect(_config: unknown): Promise<void> {}

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async query(filter: AuditQuery): Promise<AuditEvent[]> {
    const matched = this.events.filter((event) => {
      if (filter.run !== undefined) {
        if (event.run.branchName !== filter.run.branchName || event.run.startedAt !== filter.run.startedAt) {
          return false;
        }
      }

      if (filter.branchName !== undefined && event.run.branchName !== filter.branchName) {
        return false;
      }

      if (filter.eventTypes !== undefined && !filter.eventTypes.includes(event.type)) {
        return false;
      }

      if (filter.fromIso !== undefined && event.createdAt < filter.fromIso) {
        return false;
      }
      if (filter.toIso !== undefined && event.createdAt > filter.toIso) {
        return false;
      }

      return true;
    });

    if (filter.limit === undefined || filter.limit >= matched.length) {
      return matched;
    }
    return matched.slice(0, filter.limit);
  }

  async getRun(run: WorkflowRunKey): Promise<WorkflowRun | null> {
    return this.runs.get(runIdentity(run)) ?? null;
  }

  async saveRun(run: WorkflowRun): Promise<void> {
    this.runs.set(runIdentity(run.key), run);
  }

  async close(): Promise<void> {}
}

export class InMemoryGitPort implements GitPort {
  readonly branches: Set<string>;

  readonly createdBranches: string[] = [];

  drifted = false;

  mergeResult: MergeResult = {
    status: "up_to_date",
  };

  mergeStrategiesUsed: string[] = [];

  driftPaths: string[] = [];

  conflictFiles: string[] = [];

  resolvedConflictFiles: string[] = [];

  continueMergeMessage: string | undefined;

  abortMergeCalled = false;

  private current: string;

  constructor(initialBranches: string[], currentBranch: string) {
    this.branches = new Set(initialBranches);
    this.current = currentBranch;
  }

  async currentBranch(): Promise<string> {
    return this.current;
  }

  async branchExists(name: string): Promise<boolean> {
    return this.branches.has(name);
  }

  async createBranch(name: string): Promise<void> {
    this.branches.add(name);
    this.createdBranches.push(name);
    this.current = name;
  }

  async mergeMainIntoCurrent(_mainBranch: string, strategy: "merge-main" | "rebase-main" = "merge-main"): Promise<MergeResult> {
    this.mergeStrategiesUsed.push(strategy);
    return this.mergeResult;
  }

  async isMainDrifted(_mainBranch: string): Promise<boolean> {
    return this.drifted;
  }

  async listDriftPaths(_mainBranch: string): Promise<string[]> {
    return [...this.driftPaths];
  }

  async headSha(_branch: string): Promise<string> {
    return "head-sha";
  }

  async detectConflictFiles(): Promise<string[]> {
    return [...this.conflictFiles];
  }

  async markConflictFilesResolved(files: readonly string[]): Promise<void> {
    this.resolvedConflictFiles.push(...files);
  }

  async continueMerge(message?: string): Promise<void> {
    this.continueMergeMessage = message;
  }

  async abortMerge(): Promise<void> {
    this.abortMergeCalled = true;
  }
}

export class InMemoryMasterDocStore implements MasterDocStore {
  previews: SyncPreview[] = [];

  syncResults: SyncResult[] = [];

  failApplyWithMessage?: string;

  async load(ref: { path: string }): Promise<{ ref: { path: string }; body: string }> {
    return {
      ref,
      body: "",
    };
  }

  async planSync(changeSet: SyncChangeSet): Promise<SyncPreview> {
    const preview: SyncPreview = {
      run: changeSet.run,
      operations: changeSet.operations,
      warnings: [],
    };
    this.previews.push(preview);
    return preview;
  }

  async applySync(changeSet: SyncChangeSet): Promise<SyncResult> {
    if (this.failApplyWithMessage !== undefined) {
      throw new Error(this.failApplyWithMessage);
    }

    const result: SyncResult = {
      run: changeSet.run,
      success: true,
      appliedOperations: changeSet.operations,
      message: "sync applied",
    };
    this.syncResults.push(result);
    return result;
  }
}

export class InMemoryPullRequestPort implements PullRequestPort {
  readonly requests: PullRequestCreateInput[] = [];

  nextResult: PullRequestCreateResult = {
    url: "https://example.com/pr/1",
  };

  failWithMessage: string | undefined;

  async create(input: PullRequestCreateInput): Promise<PullRequestCreateResult> {
    this.requests.push(input);

    if (this.failWithMessage !== undefined) {
      throw new Error(this.failWithMessage);
    }

    return {
      ...this.nextResult,
    };
  }
}

export class InMemoryInitializationStore implements InitializationStore {
  private readonly states = new Map<string, InitializationState>();

  async load(projectRoot: string): Promise<InitializationState | null> {
    return this.states.get(projectRoot) ?? null;
  }

  async save(projectRoot: string, state: InitializationState): Promise<void> {
    this.states.set(projectRoot, state);
  }

  seed(projectRoot: string, state: InitializationState): void {
    this.states.set(projectRoot, state);
  }
}

export class InMemoryInitializationWorkspacePort implements InitializationWorkspacePort {
  calls: InitializationBootstrapInput[] = [];

  nextOutput: InitializationBootstrapOutput = {
    generatedArtifacts: ["README.md", "AGENTS.md", "CONSTITUTION.md", "docs/master/root-spec.md"],
    createdArtifacts: ["README.md", "AGENTS.md", "CONSTITUTION.md", "docs/master/root-spec.md"],
    updatedArtifacts: [],
    reconciliationRequired: false,
    reconciliationFindings: [],
    scanSummary: {
      scannedAt: "2026-03-24T00:00:00.000Z",
      fileCount: 0,
      sourceFileCount: 0,
      markdownDocCount: 0,
    },
  };

  async bootstrap(input: InitializationBootstrapInput): Promise<InitializationBootstrapOutput> {
    this.calls.push(input);
    return structuredClone(this.nextOutput);
  }
}

export class InMemoryConfigStore implements ConfigStore {
  private readonly configs = new Map<string, Record<string, unknown>>();

  async load(projectRoot: string): Promise<Record<string, unknown>> {
    const current = this.configs.get(projectRoot);
    if (current === undefined) {
      return {};
    }

    return structuredClone(current);
  }

  async save(projectRoot: string, config: Record<string, unknown>): Promise<void> {
    this.configs.set(projectRoot, structuredClone(config));
  }

  seed(projectRoot: string, config: Record<string, unknown>): void {
    this.configs.set(projectRoot, structuredClone(config));
  }
}

export class InMemorySystemAssetsPort implements SystemAssetsPort {
  calls: SystemAssetsUpdateInput[] = [];

  nextResult: SystemAssetsUpdateResult = {
    updatedFiles: [],
    skippedFiles: [],
    removedFiles: [],
  };

  async update(input: SystemAssetsUpdateInput): Promise<SystemAssetsUpdateResult> {
    this.calls.push(input.dryRun === undefined ? {} : { dryRun: input.dryRun });

    return {
      updatedFiles: [...this.nextResult.updatedFiles],
      skippedFiles: [...this.nextResult.skippedFiles],
      removedFiles: [...this.nextResult.removedFiles],
    };
  }
}

export function runIdentity(run: WorkflowRunKey): string {
  return `${run.branchName}::${run.startedAt}`;
}

export function fixedClock(...values: string[]): () => string {
  const queue = [...values];
  return () => queue.shift() ?? values[values.length - 1] ?? "2026-03-24T00:00:00.000Z";
}

export function createEventSequence(prefix = "evt"): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}
