import { createWorkflowRun } from "@specforge/domain";
import { describe, expect, it } from "vitest";
import { createCommandContext } from "../src/orchestration/command-context.js";
import { DefaultValidationService } from "../src/services/validation-service.js";
import { InMemoryAuditDriver, InMemoryGitPort, createEventSequence, fixedClock } from "./helpers/in-memory.js";

describe("DefaultValidationService", () => {
  it("runs validation checks and transitions implementing -> validation", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/search",
        startedAt: "2026-03-24T17:00:00.000Z",
      },
      workType: "feature",
      title: "Search",
      nowIso: "2026-03-24T17:00:00.000Z",
    });

    await auditDriver.saveRun({
      ...run,
      state: "implementing",
      metadata: {
        simulatedFailedChecks: ["pnpm -r test"],
      },
    });

    const service = new DefaultValidationService({
      auditDriver,
      now: fixedClock("2026-03-24T17:01:00.000Z", "2026-03-24T17:02:00.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "agent", id: "codex" },
      cwd: "/repo",
      projectRoot: "/repo",
      ruleSources: {
        prompt: {
          validationChecks: ["pnpm -r lint", "pnpm -r test"],
        },
      },
    });

    const result = await service.run(
      {
        run: run.key,
      },
      context,
    );

    expect(result.state).toBe("validation");
    expect(result.checksRun).toEqual(["pnpm -r lint", "pnpm -r test"]);
    expect(result.failedChecks).toEqual(["pnpm -r test"]);

    const savedRun = await auditDriver.getRun(run.key);
    expect(savedRun?.state).toBe("validation");
    expect(auditDriver.events.some((event) => event.type === "implementation_completed")).toBe(true);
  });

  it("decides validation at hard gate and records applied rule sources", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/refinement/cache",
        startedAt: "2026-03-24T17:20:00.000Z",
      },
      workType: "refinement",
      title: "Cache improvements",
      nowIso: "2026-03-24T17:20:00.000Z",
    });

    await auditDriver.saveRun({
      ...run,
      state: "validation",
    });

    const service = new DefaultValidationService({
      auditDriver,
      now: fixedClock("2026-03-24T17:21:00.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      ruleSources: {
        constitution: {
          autoAdvanceHardGates: false,
        },
      },
    });

    const result = await service.decide(
      {
        run: run.key,
        decision: "changes_requested",
        approved: true,
        unresolvedFailedGates: ["pnpm -r test"],
      },
      context,
    );

    expect(result.state).toBe("rework");
    expect(result.decision).toBe("changes_requested");

    const decisionEvent = auditDriver.events.find((event) => event.type === "validation_changes_requested");
    expect(decisionEvent?.payload).toMatchObject({
      hardGate: "validation_decision",
    });
  });

  it("runs validation from plan_approved by entering implementation first", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/from-plan",
        startedAt: "2026-03-24T18:00:00.000Z",
      },
      workType: "feature",
      title: "From plan",
      nowIso: "2026-03-24T18:00:00.000Z",
    });

    await auditDriver.saveRun({
      ...run,
      state: "plan_approved",
    });

    const service = new DefaultValidationService({
      auditDriver,
      now: fixedClock("2026-03-24T18:01:00.000Z", "2026-03-24T18:02:00.000Z", "2026-03-24T18:03:00.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.run(
      {
        run: run.key,
      },
      context,
    );

    expect(result.state).toBe("validation");
    expect(auditDriver.events.some((event) => event.type === "implementation_started")).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "implementation_completed")).toBe(true);
  });

  it("runs validation from rework by applying rework before validation", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/refinement/rework",
        startedAt: "2026-03-24T18:10:00.000Z",
      },
      workType: "refinement",
      title: "Rework path",
      nowIso: "2026-03-24T18:10:00.000Z",
    });

    await auditDriver.saveRun({
      ...run,
      state: "rework",
    });

    const service = new DefaultValidationService({
      auditDriver,
      now: fixedClock("2026-03-24T18:11:00.000Z", "2026-03-24T18:12:00.000Z", "2026-03-24T18:13:00.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "agent", id: "codex" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.run(
      {
        run: run.key,
      },
      context,
    );

    expect(result.state).toBe("validation");
    expect(auditDriver.events.some((event) => event.type === "implementation_started")).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "implementation_completed")).toBe(true);
  });

  it("requires explicit confirmation when drift is detected before implementation", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.drifted = true;
    gitPort.mergeResult = {
      status: "merged",
      message: "merged main",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/pre-impl-drift",
        startedAt: "2026-03-24T18:20:00.000Z",
      },
      workType: "feature",
      title: "Pre implementation drift",
      nowIso: "2026-03-24T18:20:00.000Z",
    });

    await auditDriver.saveRun({
      ...run,
      state: "plan_approved",
    });

    const service = new DefaultValidationService({
      auditDriver,
      gitPort,
      now: fixedClock("2026-03-24T18:21:00.000Z", "2026-03-24T18:21:10.000Z", "2026-03-24T18:21:20.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    await expect(
      service.run(
        {
          run: run.key,
        },
        context,
      ),
    ).rejects.toThrow("explicit confirmation");

    expect(auditDriver.events.some((event) => event.type === "drift_detected")).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "main_merge_completed")).toBe(true);
  });

  it("emits conflict-resolution proposal when automated pre-implementation drift merge conflicts", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.drifted = true;
    gitPort.mergeResult = {
      status: "conflict",
      conflictFiles: ["README.md"],
      message: "conflict",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/pre-impl-conflict",
        startedAt: "2026-03-24T18:25:00.000Z",
      },
      workType: "feature",
      title: "Pre implementation conflict",
      nowIso: "2026-03-24T18:25:00.000Z",
    });

    await auditDriver.saveRun({
      ...run,
      state: "plan_approved",
    });

    const service = new DefaultValidationService({
      auditDriver,
      gitPort,
      now: fixedClock("2026-03-24T18:26:00.000Z", "2026-03-24T18:26:10.000Z", "2026-03-24T18:26:20.000Z"),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    await expect(
      service.run(
        {
          run: run.key,
        },
        context,
      ),
    ).rejects.toThrow("merge conflicts");

    expect(auditDriver.events.some((event) => event.type === "merge_conflict_detected")).toBe(true);
    expect(auditDriver.events.some((event) => event.type === "merge_conflict_resolution_proposed")).toBe(true);
  });

  it("moves workflow to rework when drift impact analysis flags misalignment", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.drifted = true;
    gitPort.mergeResult = {
      status: "merged",
      message: "merged main",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/pre-impl-rework",
        startedAt: "2026-03-24T18:30:00.000Z",
      },
      workType: "feature",
      title: "Pre implementation rework",
      nowIso: "2026-03-24T18:30:00.000Z",
    });

    await auditDriver.saveRun({
      ...run,
      state: "plan_approved",
      metadata: {
        simulateDriftMisalignment: true,
      },
    });

    const service = new DefaultValidationService({
      auditDriver,
      gitPort,
      now: fixedClock(
        "2026-03-24T18:31:00.000Z",
        "2026-03-24T18:31:10.000Z",
        "2026-03-24T18:31:20.000Z",
        "2026-03-24T18:31:30.000Z",
        "2026-03-24T18:31:40.000Z",
        "2026-03-24T18:31:50.000Z",
      ),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.run(
      {
        run: run.key,
        approveDriftAnalysis: true,
      },
      context,
    );

    expect(result.state).toBe("rework");
    expect(result.failedChecks).toContain("drift_misalignment");
    expect(auditDriver.events.some((event) => event.type === "validation_changes_requested")).toBe(true);
  });

  it("applies drift strategy override from rules before implementation", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.drifted = true;
    gitPort.mergeResult = {
      status: "up_to_date",
      message: "already rebased",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/pre-impl-strategy",
        startedAt: "2026-03-24T18:35:00.000Z",
      },
      workType: "feature",
      title: "Pre implementation strategy",
      nowIso: "2026-03-24T18:35:00.000Z",
    });

    await auditDriver.saveRun({
      ...run,
      state: "plan_approved",
    });

    const service = new DefaultValidationService({
      auditDriver,
      gitPort,
      now: fixedClock("2026-03-24T18:36:00.000Z", "2026-03-24T18:36:10.000Z", "2026-03-24T18:36:20.000Z"),
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

    const result = await service.run(
      {
        run: run.key,
        approveDriftAnalysis: true,
      },
      context,
    );

    expect(result.state).toBe("validation");
    expect(gitPort.mergeStrategiesUsed).toContain("rebase-main");
  });

  it("detects scope misalignment when drift changes feature specs outside confirmed scope", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const gitPort = new InMemoryGitPort(["main"], "main");
    gitPort.drifted = true;
    gitPort.driftPaths = ["docs/master/features/billing.md"];
    gitPort.mergeResult = {
      status: "merged",
      message: "merged",
    };

    const run = createWorkflowRun({
      key: {
        branchName: "sf/feature/spec-mismatch",
        startedAt: "2026-03-24T18:40:00.000Z",
      },
      workType: "feature",
      title: "Spec mismatch",
      nowIso: "2026-03-24T18:40:00.000Z",
      affectedSectionIds: ["sec-checkout"],
    });

    await auditDriver.saveRun({
      ...run,
      state: "plan_approved",
    });

    const service = new DefaultValidationService({
      auditDriver,
      gitPort,
      now: fixedClock(
        "2026-03-24T18:41:00.000Z",
        "2026-03-24T18:41:10.000Z",
        "2026-03-24T18:41:20.000Z",
        "2026-03-24T18:41:30.000Z",
      ),
      createEventId: createEventSequence(),
    });

    const context = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const result = await service.run(
      {
        run: run.key,
        approveDriftAnalysis: true,
      },
      context,
    );

    expect(result.state).toBe("rework");
    expect(result.failedChecks).toContain("drift_misalignment");
  });
});
