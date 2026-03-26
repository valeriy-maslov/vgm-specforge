import { createWorkflowRun } from "@specforge/domain";
import { describe, expect, it } from "vitest";
import { createCommandContext } from "../src/orchestration/command-context.js";
import { DefaultCompletionService } from "../src/services/completion-service.js";
import {
  InMemoryAuditDriver,
  InMemoryGitPort,
  InMemoryMasterDocStore,
  InMemoryPullRequestPort,
  createEventSequence,
  fixedClock,
} from "./helpers/in-memory.js";

describe("DefaultCompletionService", () => {
  it("generates preview and approves sync preview hard gate", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/profile",
        startedAt: "2026-03-24T18:00:00.000Z",
      },
      workType: "feature",
      title: "Profile",
      nowIso: "2026-03-24T18:00:00.000Z",
      affectedSectionIds: ["sec-profile"],
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      now: fixedClock("2026-03-24T18:01:00.000Z", "2026-03-24T18:02:00.000Z", "2026-03-24T18:03:00.000Z"),
      createEventId: createEventSequence(),
    });

    const previewContext = createCommandContext({
      actor: { kind: "agent", id: "codex" },
      cwd: "/repo",
      projectRoot: "/repo",
      requestId: "req-preview",
    });

    const preview = await service.preview(
      {
        run: run.key,
      },
      previewContext,
    );

    expect(preview.preview.operations.length).toBeGreaterThan(0);
    expect(auditDriver.events.some((event) => event.type === "sync_preview_generated")).toBe(true);

    const approveContext = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      ruleSources: {
        prompt: {
          autoAdvanceHardGates: false,
        },
      },
    });

    const approved = await service.approve(
      {
        run: run.key,
        approved: true,
      },
      approveContext,
    );

    expect(approved.state).toBe("ready_to_complete");

    const approveEvent = auditDriver.events.find((event) => event.type === "sync_preview_approved");
    expect(approveEvent?.payload).toMatchObject({
      hardGate: "final_sync_preview_approval",
    });
  });

  it("returns to rework when unresolved failures exist and force was not requested", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/search",
        startedAt: "2026-03-24T18:10:00.000Z",
      },
      workType: "feature",
      title: "Search",
      nowIso: "2026-03-24T18:10:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      unresolvedFailedGates: ["pnpm -r test"],
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T18:10:30.000Z",
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      now: fixedClock("2026-03-24T18:11:00.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.sync(
      {
        run: run.key,
      },
      context,
    );

    expect(result.state).toBe("rework");
    expect(result.result.success).toBe(false);
    expect(masterDocStore.syncResults).toHaveLength(0);
    expect(auditDriver.events.some((event) => event.type === "completion_triggered")).toBe(true);
  });

  it("requires explicit confirmation when drift is detected before completion sync", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.drifted = true;
    gitPort.mergeResult = {
      status: "merged",
      message: "merged main",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/pre-complete-drift",
        startedAt: "2026-03-24T18:15:00.000Z",
      },
      workType: "feature",
      title: "Pre completion drift",
      nowIso: "2026-03-24T18:15:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T18:15:30.000Z",
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      gitPort,
      now: fixedClock("2026-03-24T18:16:00.000Z", "2026-03-24T18:16:10.000Z", "2026-03-24T18:16:20.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    await expect(
      service.sync(
        {
          run: run.key,
        },
        context,
      ),
    ).rejects.toThrow("explicit confirmation");

    expect(auditDriver.events.some((event) => event.type === "drift_detected")).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "main_merge_completed")).toBe(true);
  });

  it("emits conflict-resolution proposal when automated pre-completion drift merge conflicts", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.drifted = true;
    gitPort.mergeResult = {
      status: "conflict",
      conflictFiles: ["docs/master/root-spec.md"],
      message: "conflict",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/pre-complete-conflict",
        startedAt: "2026-03-24T18:16:00.000Z",
      },
      workType: "feature",
      title: "Pre completion conflict",
      nowIso: "2026-03-24T18:16:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T18:16:30.000Z",
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      gitPort,
      now: fixedClock("2026-03-24T18:17:00.000Z", "2026-03-24T18:17:10.000Z", "2026-03-24T18:17:20.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    await expect(
      service.sync(
        {
          run: run.key,
        },
        context,
      ),
    ).rejects.toThrow("merge conflicts");

    expect(auditDriver.events.some((event) => event.type === "merge_conflict_detected")).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "merge_conflict_resolution_proposed")).toBe(true);
  });

  it("returns to rework when drift analysis indicates misalignment before sync", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.drifted = true;
    gitPort.mergeResult = {
      status: "merged",
      message: "merged main",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/pre-complete-rework",
        startedAt: "2026-03-24T18:17:00.000Z",
      },
      workType: "feature",
      title: "Pre completion rework",
      nowIso: "2026-03-24T18:17:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T18:17:30.000Z",
        simulateDriftMisalignment: true,
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      gitPort,
      now: fixedClock("2026-03-24T18:18:00.000Z", "2026-03-24T18:18:10.000Z", "2026-03-24T18:18:20.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.sync(
      {
        run: run.key,
        approveDriftAnalysis: true,
      },
      context,
    );

    expect(result.state).toBe("rework");
    expect(result.result.success).toBe(false);
    expect(masterDocStore.syncResults).toHaveLength(0);
  });

  it("applies drift strategy override from rules before completion sync", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.drifted = true;
    gitPort.mergeResult = {
      status: "up_to_date",
      message: "already rebased",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/pre-complete-strategy",
        startedAt: "2026-03-24T18:19:00.000Z",
      },
      workType: "feature",
      title: "Pre completion strategy",
      nowIso: "2026-03-24T18:19:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T18:19:30.000Z",
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      gitPort,
      now: fixedClock("2026-03-24T18:20:00.000Z", "2026-03-24T18:20:10.000Z", "2026-03-24T18:20:20.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      ruleSources: {
        prompt: {
          driftStrategy: "rebase-main",
        },
      },
    });

    const result = await service.sync(
      {
        run: run.key,
        approveDriftAnalysis: true,
      },
      context,
    );

    expect(result.state).toBe("completed");
    expect(gitPort.mergeStrategiesUsed).toContain("rebase-main");
  });

  it("syncs successfully when preview is approved and force request exists", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/refactor/http-client",
        startedAt: "2026-03-24T18:20:00.000Z",
      },
      workType: "refactor",
      title: "HTTP refactor",
      nowIso: "2026-03-24T18:20:00.000Z",
      affectedSectionIds: ["sec-transport"],
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      unresolvedFailedGates: ["pnpm -r test"],
      forceCompletionRequested: true,
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T18:20:40.000Z",
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      now: fixedClock("2026-03-24T18:21:00.000Z", "2026-03-24T18:21:10.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.sync(
      {
        run: run.key,
      },
      context,
    );

    expect(result.state).toBe("completed");
    expect(result.result.success).toBe(true);
    expect(result.result.appliedOperations.length).toBeGreaterThan(0);
    expect(auditDriver.events.some((event) => event.type === "master_docs_sync_started")).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "workflow_completed")).toBe(true);

    const savedRun = await auditDriver.getRun(run.key);
    expect(savedRun?.metadata).toMatchObject({
      completionRetention: {
        retainArtifacts: false,
        mode: "history-only",
      },
    });
  });

  it("attempts optional pull request creation on explicit request", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const pullRequestPort = new InMemoryPullRequestPort();

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/pr-success",
        startedAt: "2026-03-24T18:30:00.000Z",
      },
      workType: "feature",
      title: "PR success",
      nowIso: "2026-03-24T18:30:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T18:30:30.000Z",
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      pullRequestPort,
      now: fixedClock("2026-03-24T18:31:00.000Z", "2026-03-24T18:31:10.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.sync(
      {
        run: run.key,
        requestPullRequest: true,
        pullRequestTitle: "SpecForge PR",
      },
      context,
    );

    expect(result.state).toBe("completed");
    expect(result.result.success).toBe(true);
    expect(result.pullRequest).toEqual({
      requested: true,
      created: true,
      url: "https://example.com/pr/1",
    });
    expect(pullRequestPort.requests).toHaveLength(1);
    expect(pullRequestPort.requests[0]).toMatchObject({
      branchName: run.key.branchName,
      title: "SpecForge PR",
    });
  });

  it("does not block completion when requested pull request creation fails", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const pullRequestPort = new InMemoryPullRequestPort();
    pullRequestPort.failWithMessage = "gh auth missing";

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/pr-fail",
        startedAt: "2026-03-24T18:35:00.000Z",
      },
      workType: "feature",
      title: "PR fail",
      nowIso: "2026-03-24T18:35:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T18:35:30.000Z",
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      pullRequestPort,
      now: fixedClock("2026-03-24T18:36:00.000Z", "2026-03-24T18:36:10.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.sync(
      {
        run: run.key,
        requestPullRequest: true,
      },
      context,
    );

    expect(result.state).toBe("completed");
    expect(result.result.success).toBe(true);
    expect(result.result.message).toContain("pull request creation failed");
    expect(result.pullRequest).toMatchObject({
      requested: true,
      created: false,
    });
  });

  it("stays ready_to_complete when sync apply fails", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    masterDocStore.failApplyWithMessage = "disk full";

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/billing",
        startedAt: "2026-03-24T18:40:00.000Z",
      },
      workType: "feature",
      title: "Billing",
      nowIso: "2026-03-24T18:40:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T18:40:30.000Z",
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      now: fixedClock("2026-03-24T18:41:00.000Z", "2026-03-24T18:41:10.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.sync(
      {
        run: run.key,
      },
      context,
    );

    expect(result.state).toBe("ready_to_complete");
    expect(result.result.success).toBe(false);
    expect(result.result.message).toContain("disk full");
    expect(auditDriver.events.some((event) => event.type === "sync_failed")).toBe(true);
  });

  it("records explicit force completion request", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/exports",
        startedAt: "2026-03-24T18:50:00.000Z",
      },
      workType: "feature",
      title: "Exports",
      nowIso: "2026-03-24T18:50:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      unresolvedFailedGates: ["pnpm -r test"],
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      now: fixedClock("2026-03-24T18:51:00.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const force = await service.force(
      {
        run: run.key,
        reason: "accept risk for known flaky test",
        approvedBy: "alice",
      },
      context,
    );

    expect(force.requested).toBe(true);
    expect(force.state).toBe("ready_to_complete");
    expect(auditDriver.events.some((event) => event.type === "force_completion_requested")).toBe(true);
  });

  it("requires fresh sync preview approval after force completion is requested", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/force-reapproval",
        startedAt: "2026-03-24T18:55:00.000Z",
      },
      workType: "feature",
      title: "Force reapproval",
      nowIso: "2026-03-24T18:55:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      unresolvedFailedGates: ["pnpm -r test"],
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T18:55:30.000Z",
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      now: fixedClock(
        "2026-03-24T18:56:00.000Z",
        "2026-03-24T18:56:10.000Z",
        "2026-03-24T18:56:20.000Z",
        "2026-03-24T18:56:30.000Z",
      ),
      createEventId: createEventSequence(),
    });

    const userContext = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    await service.force(
      {
        run: run.key,
        reason: "accept risk",
        approvedBy: "alice",
      },
      userContext,
    );

    await expect(
      service.sync(
        {
          run: run.key,
        },
        userContext,
      ),
    ).rejects.toThrow("sync preview must be approved");

    await service.approve(
      {
        run: run.key,
        approved: true,
      },
      userContext,
    );

    const syncResult = await service.sync(
      {
        run: run.key,
      },
      userContext,
    );

    expect(syncResult.state).toBe("completed");
  });

  it("records sync retry request on user-triggered retry", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/retry-sync",
        startedAt: "2026-03-24T19:00:00.000Z",
      },
      workType: "feature",
      title: "Retry sync",
      nowIso: "2026-03-24T19:00:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T19:00:30.000Z",
        lastSyncFailureAt: "2026-03-24T19:01:00.000Z",
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      now: fixedClock("2026-03-24T19:02:00.000Z", "2026-03-24T19:02:10.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.sync(
      {
        run: run.key,
      },
      context,
    );

    expect(result.state).toBe("completed");
    expect(auditDriver.events.some((event) => event.type === "sync_retry_requested")).toBe(true);
  });

  it("blocks agent-triggered sync retry by default", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const masterDocStore = new InMemoryMasterDocStore();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/retry-agent",
        startedAt: "2026-03-24T19:10:00.000Z",
      },
      workType: "feature",
      title: "Retry agent",
      nowIso: "2026-03-24T19:10:00.000Z",
    });
    await auditDriver.saveRun({
      ...run,
      state: "ready_to_complete",
      metadata: {
        syncPreviewApprovedAt: "2026-03-24T19:10:30.000Z",
        lastSyncFailureAt: "2026-03-24T19:11:00.000Z",
      },
    });

    const service = new DefaultCompletionService({
      auditDriver,
      masterDocStore,
      now: fixedClock("2026-03-24T19:12:00.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "agent", id: "codex" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    await expect(
      service.sync(
        {
          run: run.key,
        },
        context,
      ),
    ).rejects.toThrow("agent-triggered sync retry is disabled");
  });
});
