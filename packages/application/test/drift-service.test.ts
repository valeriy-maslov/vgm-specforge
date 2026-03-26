import { createWorkflowRun } from "@specforge/domain";
import { describe, expect, it } from "vitest";
import { createCommandContext } from "../src/orchestration/command-context.js";
import { DefaultDriftService } from "../src/services/drift-service.js";
import { InMemoryAuditDriver, InMemoryGitPort, createEventSequence, fixedClock } from "./helpers/in-memory.js";

describe("DefaultDriftService", () => {
  it("detects drift and emits drift_detected event", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.drifted = true;

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/drift",
        startedAt: "2026-03-26T10:00:00.000Z",
      },
      workType: "feature",
      title: "Drift",
      nowIso: "2026-03-26T10:00:00.000Z",
    });
    await auditDriver.saveRun(run);

    const service = new DefaultDriftService({
      auditDriver,
      gitPort,
      now: fixedClock("2026-03-26T10:01:00.000Z"),
      createEventId: createEventSequence("evt"),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      requestId: "req-drift",
    });

    const result = await service.check(
      {
        run: run.key,
        mainBranch: "main",
      },
      context,
    );

    expect(result.drifted).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "drift_detected")).toBe(true);
  });

  it("merges main and emits merge lifecycle events", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.mergeResult = {
      status: "merged",
      message: "merged",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/merge",
        startedAt: "2026-03-26T10:10:00.000Z",
      },
      workType: "feature",
      title: "Merge",
      nowIso: "2026-03-26T10:10:00.000Z",
    });
    await auditDriver.saveRun(run);

    const service = new DefaultDriftService({
      auditDriver,
      gitPort,
      now: fixedClock("2026-03-26T10:11:00.000Z", "2026-03-26T10:11:10.000Z"),
      createEventId: createEventSequence("evt"),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      requestId: "req-merge",
    });

    const result = await service.mergeMain(
      {
        run: run.key,
        mainBranch: "main",
      },
      context,
    );

    expect(result.result.status).toBe("merged");
    expect(auditDriver.events.some((event) => event.type === "main_merge_started")).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "main_merge_completed")).toBe(true);
  });

  it("records conflict detection when merge results in conflicts", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.mergeResult = {
      status: "conflict",
      conflictFiles: ["README.md"],
      message: "conflict",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/conflict",
        startedAt: "2026-03-26T10:20:00.000Z",
      },
      workType: "feature",
      title: "Conflict",
      nowIso: "2026-03-26T10:20:00.000Z",
    });
    await auditDriver.saveRun(run);

    const service = new DefaultDriftService({
      auditDriver,
      gitPort,
      now: fixedClock("2026-03-26T10:21:00.000Z", "2026-03-26T10:21:10.000Z"),
      createEventId: createEventSequence("evt"),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      requestId: "req-conflict",
    });

    const result = await service.mergeMain(
      {
        run: run.key,
        mainBranch: "main",
      },
      context,
    );

    expect(result.result.status).toBe("conflict");
    expect(result.proposal?.resolutionPlan).toContain("README.md");
    expect(auditDriver.events.some((event) => event.type === "merge_conflict_detected")).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "merge_conflict_resolution_proposed")).toBe(true);
  });

  it("applies drift strategy override during merge-main", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.mergeResult = {
      status: "up_to_date",
      message: "already rebased",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/rebase-strategy",
        startedAt: "2026-03-26T10:25:00.000Z",
      },
      workType: "feature",
      title: "Rebase strategy",
      nowIso: "2026-03-26T10:25:00.000Z",
    });
    await auditDriver.saveRun(run);

    const service = new DefaultDriftService({
      auditDriver,
      gitPort,
      now: fixedClock("2026-03-26T10:26:00.000Z", "2026-03-26T10:26:10.000Z"),
      createEventId: createEventSequence("evt"),
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

    const result = await service.mergeMain(
      {
        run: run.key,
        mainBranch: "main",
      },
      context,
    );

    expect(result.result.status).toBe("up_to_date");
    expect(gitPort.mergeStrategiesUsed).toContain("rebase-main");
  });

  it("requires explicit approval before applying conflict resolution", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const gitPort = new InMemoryGitPort(["main"], "main");
    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/resolve",
        startedAt: "2026-03-26T10:30:00.000Z",
      },
      workType: "feature",
      title: "Resolve",
      nowIso: "2026-03-26T10:30:00.000Z",
    });
    await auditDriver.saveRun(run);

    const service = new DefaultDriftService({
      auditDriver,
      gitPort,
      now: fixedClock("2026-03-26T10:31:00.000Z"),
      createEventId: createEventSequence("evt"),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      requestId: "req-resolve",
    });

    await expect(
      service.resolveConflicts(
        {
          run: run.key,
          approved: false,
          resolutionPlan: "Use main branch content",
        },
        context,
      ),
    ).rejects.toThrow("must be explicitly approved");

    expect(auditDriver.events.some((event) => event.type === "merge_conflict_resolution_proposed")).toBe(true);
  });

  it("applies approved conflict resolution and emits audit events", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.conflictFiles = ["README.md", "docs/master/root-spec.md"];

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/resolve-approved",
        startedAt: "2026-03-26T10:40:00.000Z",
      },
      workType: "feature",
      title: "Resolve approved",
      nowIso: "2026-03-26T10:40:00.000Z",
    });
    await auditDriver.saveRun(run);

    const service = new DefaultDriftService({
      auditDriver,
      gitPort,
      now: fixedClock("2026-03-26T10:41:00.000Z"),
      createEventId: createEventSequence("evt"),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      requestId: "req-resolve-approved",
    });

    const result = await service.resolveConflicts(
      {
        run: run.key,
        approved: true,
      },
      context,
    );

    expect(result.resolved).toBe(true);
    expect(result.resolutionPlan).toContain("README.md");
    expect(gitPort.resolvedConflictFiles).toEqual(["README.md", "docs/master/root-spec.md"]);
    expect(auditDriver.events.some((event) => event.type === "merge_conflict_resolution_proposed")).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "merge_conflict_resolution_approved")).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "merge_conflict_resolution_applied")).toBe(true);
  });
});
