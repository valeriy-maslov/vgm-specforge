import { createWorkflowRun } from "@specforge/domain";
import { describe, expect, it } from "vitest";
import { createCommandContext } from "../src/orchestration/command-context.js";
import { DefaultPlanService } from "../src/services/plan-service.js";
import { DefaultSpecService } from "../src/services/spec-service.js";
import { InMemoryAuditDriver, createEventSequence, fixedClock } from "./helpers/in-memory.js";

describe("Spec and plan services", () => {
  it("drafts and approves spec with hard-gate rule audit payload", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const baseRun = createWorkflowRun({
      key: {
        branchName: "sf/feature/checkout",
        startedAt: "2026-03-24T16:00:00.000Z",
      },
      workType: "feature",
      title: "Checkout",
      nowIso: "2026-03-24T16:00:00.000Z",
      affectedSectionIds: ["sec-checkout"],
    });

    await auditDriver.saveRun({
      ...baseRun,
      state: "scope_confirmed",
    });

    const specService = new DefaultSpecService({
      auditDriver,
      now: fixedClock("2026-03-24T16:01:00.000Z", "2026-03-24T16:02:00.000Z"),
      createEventId: createEventSequence(),
    });

    const draftContext = createCommandContext({
      actor: { kind: "agent", id: "codex" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const draftOutput = await specService.draft(
      {
        run: baseRun.key,
      },
      draftContext,
    );

    expect(draftOutput.state).toBe("spec_drafting");
    expect(draftOutput.draftPath).toContain("work-spec.md");

    const approveContext = createCommandContext({
      actor: { kind: "user", id: "alice" },
      cwd: "/repo",
      projectRoot: "/repo",
      ruleSources: {
        prompt: {
          autoAdvanceHardGates: true,
        },
        constitution: {
          driftStrategy: "rebase-main",
        },
      },
    });

    const approveOutput = await specService.approve(
      {
        run: baseRun.key,
        approved: true,
      },
      approveContext,
    );

    expect(approveOutput.state).toBe("spec_approved");
    expect(approveOutput.appliedRuleSources).toEqual(expect.arrayContaining(["prompt", "constitution"]));

    const specApprovedEvent = auditDriver.events.find((event) => event.type === "spec_approved");
    expect(specApprovedEvent?.payload).toMatchObject({
      hardGate: "spec_approval",
    });
  });

  it("drafts and approves plan with hard-gate rule audit payload", async () => {
    const auditDriver = new InMemoryAuditDriver();
    const run = createWorkflowRun({
      key: {
        branchName: "sf/refinement/catalog",
        startedAt: "2026-03-24T16:30:00.000Z",
      },
      workType: "refinement",
      title: "Catalog tweaks",
      nowIso: "2026-03-24T16:30:00.000Z",
    });

    await auditDriver.saveRun({
      ...run,
      state: "spec_approved",
    });

    const planService = new DefaultPlanService({
      auditDriver,
      now: fixedClock("2026-03-24T16:31:00.000Z", "2026-03-24T16:32:00.000Z"),
      createEventId: createEventSequence(),
    });

    const draftContext = createCommandContext({
      actor: { kind: "agent", id: "codex" },
      cwd: "/repo",
      projectRoot: "/repo",
    });

    const draft = await planService.draft(
      {
        run: run.key,
      },
      draftContext,
    );

    expect(draft.state).toBe("plan_drafting");
    expect(draft.draftPath).toContain("implementation-plan.md");

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

    const approve = await planService.approve(
      {
        run: run.key,
        approved: true,
      },
      approveContext,
    );

    expect(approve.state).toBe("plan_approved");
    expect(approve.appliedRuleSources).toEqual(expect.arrayContaining(["prompt"]));

    const planApprovedEvent = auditDriver.events.find((event) => event.type === "plan_approved");
    expect(planApprovedEvent?.payload).toMatchObject({
      hardGate: "plan_approval",
    });
  });
});
