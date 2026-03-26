import type {
  AuditDriver,
  AuditEvent,
  AuditQuery,
  GitPort,
  InitializationState,
  InitializationStore,
  MergeResult,
  WorkflowRun,
  WorkflowRunKey,
} from "@specforge/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkflowRun } from "@specforge/domain";
import { createCommandContext } from "../src/orchestration/command-context.js";
import { DefaultWorkflowService } from "../src/services/workflow-service.js";

class InMemoryAuditDriver implements AuditDriver {
  readonly runs = new Map<string, WorkflowRun>();

  readonly events: AuditEvent[] = [];

  async connect(_config: unknown): Promise<void> {}

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async query(filter: AuditQuery): Promise<AuditEvent[]> {
    return this.events.filter((event) => {
      if (filter.run !== undefined) {
        if (
          event.run.branchName !== filter.run.branchName ||
          event.run.startedAt !== filter.run.startedAt
        ) {
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
  }

  async getRun(run: WorkflowRunKey): Promise<WorkflowRun | null> {
    return this.runs.get(runIdentity(run)) ?? null;
  }

  async saveRun(run: WorkflowRun): Promise<void> {
    this.runs.set(runIdentity(run.key), run);
  }

  async close(): Promise<void> {}
}

class InMemoryGitPort implements GitPort {
  readonly branches: Set<string>;

  readonly createdBranches: string[] = [];

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

  async mergeMainIntoCurrent(_mainBranch: string): Promise<MergeResult> {
    return { status: "up_to_date" };
  }

  async isMainDrifted(_mainBranch: string): Promise<boolean> {
    return false;
  }

  async listDriftPaths(_mainBranch: string): Promise<string[]> {
    return [];
  }

  async headSha(_branch: string): Promise<string> {
    return "head-sha";
  }

  async detectConflictFiles(): Promise<string[]> {
    return [];
  }

  async markConflictFilesResolved(_files: readonly string[]): Promise<void> {}

  async continueMerge(_message?: string): Promise<void> {}

  async abortMerge(): Promise<void> {}
}

class InMemoryInitializationStore implements InitializationStore {
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

function runIdentity(run: WorkflowRunKey): string {
  return `${run.branchName}::${run.startedAt}`;
}

function clock(...values: string[]): () => string {
  const queue = [...values];
  return () => queue.shift() ?? values[values.length - 1] ?? "2026-03-24T00:00:00.000Z";
}

describe("DefaultWorkflowService", () => {
  let auditDriver: InMemoryAuditDriver;
  let gitPort: InMemoryGitPort;
  let initializationStore: InMemoryInitializationStore;
  let createEventSequence: () => string;

  beforeEach(() => {
    auditDriver = new InMemoryAuditDriver();
    gitPort = new InMemoryGitPort(["main"], "main");
    initializationStore = new InMemoryInitializationStore();
    initializationStore.seed("/repo", {
      initialized: true,
      mode: "new",
      generatedArtifacts: ["README.md"],
      reconciliationRequired: false,
      pendingBundledApproval: false,
      approvedAt: "2026-03-24T09:00:00.000Z",
    });

    let eventCounter = 0;
    createEventSequence = () => {
      eventCounter += 1;
      return `evt-${eventCounter}`;
    };
  });

  it("starts a workflow, creates branch, and emits workflow_started", async () => {
    const service = new DefaultWorkflowService({
      auditDriver,
      gitPort,
      initializationStore,
      now: clock("2026-03-24T10:00:00.000Z"),
      createEventId: createEventSequence,
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      requestId: "req-1",
    });

    const result = await service.start(
      {
        title: "Add notifications",
        prompt: "Build notification center",
      },
      context,
    );

    expect(result.started).toBe(true);
    expect(result.run?.key.branchName).toBe("sf/feature/add-notifications");
    expect(gitPort.createdBranches).toEqual(["sf/feature/add-notifications"]);

    expect(auditDriver.events).toHaveLength(1);
    expect(auditDriver.events[0]?.type).toBe("workflow_started");
    expect(auditDriver.events[0]?.id).toBe("evt-1");
  });

  it("ignores start when branch already has active workflow", async () => {
    const nowIso = "2026-03-24T11:00:00.000Z";
    const existingRun = createWorkflowRun({
      key: {
        branchName: "sf/feature/add-notifications",
        startedAt: nowIso,
      },
      workType: "feature",
      title: "Existing run",
      nowIso,
    });

    await auditDriver.saveRun({
      ...existingRun,
      state: "implementing",
    });
    await auditDriver.append({
      id: "evt-existing",
      run: existingRun.key,
      type: "workflow_started",
      actor: { kind: "user", id: "alice" },
      createdAt: nowIso,
      payload: {},
    });

    gitPort.branches.add("sf/feature/add-notifications");

    const service = new DefaultWorkflowService({
      auditDriver,
      gitPort,
      initializationStore,
      now: clock("2026-03-24T11:05:00.000Z"),
      createEventId: createEventSequence,
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.start(
      {
        title: "Add notifications",
        prompt: "again",
        branchName: "sf/feature/add-notifications",
      },
      context,
    );

    expect(result.started).toBe(false);
    expect(result.message).toContain("already has an active workflow");
    expect(gitPort.createdBranches).toEqual([]);
  });

  it("appends suffix when generated branch name collides", async () => {
    gitPort.branches.add("sf/feature/add-notifications");
    gitPort.branches.add("sf/feature/add-notifications-2");

    const service = new DefaultWorkflowService({
      auditDriver,
      gitPort,
      initializationStore,
      now: clock("2026-03-24T12:00:00.000Z"),
      createEventId: createEventSequence,
    });

    const context = createCommandContext({
      actor: { kind: "user" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.start(
      {
        title: "Add notifications",
        prompt: "feature",
      },
      context,
    );

    expect(result.started).toBe(true);
    expect(result.run?.key.branchName).toBe("sf/feature/add-notifications-3");
  });

  it("applies branch naming precedence from rule sources", async () => {
    const service = new DefaultWorkflowService({
      auditDriver,
      gitPort,
      initializationStore,
      now: clock("2026-03-24T12:30:00.000Z"),
      createEventId: createEventSequence,
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      ruleSources: {
        prompt: {
          branchNamingPattern: "prompt/{workType}/{slug}",
        },
        constitution: {
          branchNamingPattern: "constitution/{workType}/{slug}",
        },
      },
    });

    const result = await service.start(
      {
        title: "Improve inbox",
        prompt: "refinement pass",
      },
      context,
    );

    expect(result.started).toBe(true);
    expect(result.run?.key.branchName).toBe("prompt/refinement/improve-inbox");
  });

  it("returns active status from current branch", async () => {
    const run = createWorkflowRun({
      key: {
        branchName: "sf/refinement/checkout-flow",
        startedAt: "2026-03-24T13:00:00.000Z",
      },
      workType: "refinement",
      title: "Checkout refinement",
      nowIso: "2026-03-24T13:00:00.000Z",
    });

    await auditDriver.saveRun({
      ...run,
      state: "validation",
    });
    await auditDriver.append({
      id: "evt-status",
      run: run.key,
      type: "workflow_started",
      actor: { kind: "user" },
      createdAt: "2026-03-24T13:00:00.000Z",
      payload: {},
    });

    gitPort = new InMemoryGitPort(["main", "sf/refinement/checkout-flow"], "sf/refinement/checkout-flow");
    const service = new DefaultWorkflowService({
      auditDriver,
      gitPort,
      initializationStore,
      now: clock("2026-03-24T13:10:00.000Z"),
      createEventId: createEventSequence,
    });

    const context = createCommandContext({
      actor: { kind: "user" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const status = await service.status({}, context);
    expect(status.active).toBe(true);
    expect(status.run?.key.branchName).toBe("sf/refinement/checkout-flow");
  });

  it("cancels a run and emits workflow_cancelled", async () => {
    const run = createWorkflowRun({
      key: {
        branchName: "sf/refactor/http-client",
        startedAt: "2026-03-24T14:00:00.000Z",
      },
      workType: "refactor",
      title: "HTTP client cleanup",
      nowIso: "2026-03-24T14:00:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "implementing",
    });
    gitPort.branches.add("sf/refactor/http-client");

    const service = new DefaultWorkflowService({
      auditDriver,
      gitPort,
      initializationStore,
      now: clock("2026-03-24T14:05:00.000Z"),
      createEventId: createEventSequence,
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.cancel(
      {
        run: run.key,
        reason: "de-scoped",
      },
      context,
    );

    expect(result.cancelled).toBe(true);
    expect(result.run.state).toBe("cancelled");
    expect(result.run.cancelledAt).toBe("2026-03-24T14:05:00.000Z");

    const cancelledEvent = auditDriver.events.find((event) => event.type === "workflow_cancelled");
    expect(cancelledEvent).toBeDefined();
    expect(cancelledEvent?.payload).toMatchObject({
      cancellationRetention: {
        branch_name: "sf/refactor/http-client",
        work_type: "refactor",
        cancellation_reason: "de-scoped",
        last_state: "implementing",
        branch_head_sha: "head-sha",
        branch_exists: true,
      },
    });

    expect(result.run.metadata).toMatchObject({
      cancellationRetention: {
        branch_name: "sf/refactor/http-client",
        cancellation_reason: "de-scoped",
      },
    });
  });

  it("blocks workflow start when initialization is not approved", async () => {
    initializationStore.seed("/repo", {
      initialized: false,
      mode: "existing",
      generatedArtifacts: ["CONSTITUTION.md"],
      reconciliationRequired: true,
      pendingBundledApproval: true,
    });

    const service = new DefaultWorkflowService({
      auditDriver,
      gitPort,
      initializationStore,
      now: clock("2026-03-24T14:30:00.000Z"),
      createEventId: createEventSequence,
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.start(
      {
        title: "Start blocked",
        prompt: "attempt start",
      },
      context,
    );

    expect(result.started).toBe(false);
    expect(result.message).toContain("initialization approval is required");
    expect(gitPort.createdBranches).toHaveLength(0);
  });

  it("masks secrets in persisted workflow events", async () => {
    const service = new DefaultWorkflowService({
      auditDriver,
      gitPort,
      initializationStore,
      now: clock("2026-03-24T15:00:00.000Z"),
      createEventId: createEventSequence,
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      requestId: "req-secret",
    });

    await service.start(
      {
        title: "Secret check",
        prompt:
          "api_key=123456 token=abcdef authorization: Bearer very-secret-token ghp_abcdefghijklmnopqrstuvwxyz postgres://alice:super-secret-password@db.example/specforge {\"api_key\":\"quoted-secret\",\"authorization\":\"Bearer quoted-token\"}",
      },
      context,
    );

    const started = auditDriver.events.find((event) => event.type === "workflow_started");
    expect(started?.payload).toMatchObject({
      prompt: expect.stringContaining("api_key=[REDACTED]"),
    });
    expect(String(started?.payload.prompt)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(String(started?.payload.prompt)).not.toContain("super-secret-password");
    expect(String(started?.payload.prompt)).toContain("postgres://[REDACTED]@db.example/specforge");
    expect(String(started?.payload.prompt)).toContain("authorization: [REDACTED]");
    expect(String(started?.payload.prompt)).toContain('"api_key":"[REDACTED]"');
    expect(String(started?.payload.prompt)).toContain('"authorization":"[REDACTED]"');
  });
});
