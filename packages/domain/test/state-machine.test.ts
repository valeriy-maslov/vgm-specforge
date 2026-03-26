import type { DomainAction, EffectiveRules, WorkflowRun } from "@specforge/contracts";
import { describe, expect, it } from "vitest";
import { createWorkflowRun } from "../src/models/workflow-run.js";
import { resolveEffectiveRules } from "../src/policies/rule-precedence.js";
import { transitionWorkflow } from "../src/state-machine/transitions.js";

const rules: EffectiveRules = resolveEffectiveRules({});
const actor = { kind: "user" as const, id: "u-1" };

function time(step: number): string {
  return `2026-03-24T10:${step.toString().padStart(2, "0")}:00.000Z`;
}

function baseRun(): WorkflowRun {
  return createWorkflowRun({
    key: {
      branchName: "sf/feature/workflow-core",
      startedAt: time(0),
    },
    workType: "feature",
    title: "Workflow core",
    nowIso: time(0),
  });
}

function inState(state: WorkflowRun["state"]): WorkflowRun {
  const run = baseRun();
  return {
    ...run,
    state,
  };
}

function apply(run: WorkflowRun, action: DomainAction, step: number, effectiveRules: EffectiveRules = rules) {
  return transitionWorkflow({
    run,
    action,
    nowIso: time(step),
    rules: effectiveRules,
    actor,
  });
}

describe("transitionWorkflow", () => {
  it("runs the canonical happy path", () => {
    const flow: Array<{ action: DomainAction; expectedState: WorkflowRun["state"] }> = [
      { action: { type: "confirm_scope", affectedSectionIds: ["sec-001"] }, expectedState: "scope_confirmed" },
      { action: { type: "start_spec_drafting" }, expectedState: "spec_drafting" },
      { action: { type: "approve_spec", approved: true }, expectedState: "spec_approved" },
      { action: { type: "start_plan_drafting" }, expectedState: "plan_drafting" },
      { action: { type: "approve_plan", approved: true }, expectedState: "plan_approved" },
      { action: { type: "start_implementation" }, expectedState: "implementing" },
      { action: { type: "complete_implementation" }, expectedState: "validation" },
      {
        action: {
          type: "validation_decision",
          decision: "accepted",
          approved: true,
          unresolvedFailedGates: [],
        },
        expectedState: "ready_to_complete",
      },
      { action: { type: "approve_sync_preview", approved: true }, expectedState: "ready_to_complete" },
      { action: { type: "sync_succeeded" }, expectedState: "completed" },
    ];

    let run = baseRun();
    for (const [index, step] of flow.entries()) {
      const result = apply(run, step.action, index + 1);
      expect(result.blockedReason).toBeUndefined();
      expect(result.nextRun.state).toBe(step.expectedState);
      run = result.nextRun;
    }

    expect(run.completedAt).toBe(time(10));
  });

  it("routes to rework when validation changes are requested", () => {
    const run = inState("validation");
    const decision = apply(
      run,
      {
        type: "validation_decision",
        decision: "changes_requested",
        approved: true,
        unresolvedFailedGates: ["tests"],
      },
      1,
    );

    expect(decision.blockedReason).toBeUndefined();
    expect(decision.nextRun.state).toBe("rework");

    const reenterImplementation = apply(decision.nextRun, { type: "apply_rework" }, 2);
    expect(reenterImplementation.nextRun.state).toBe("implementing");
  });

  it("blocks hard gate actions without approval by default", () => {
    const run = inState("spec_drafting");
    const blocked = apply(run, { type: "approve_spec", approved: false }, 1);

    expect(blocked.blockedReason).toContain("hard gate");
    expect(blocked.nextRun.state).toBe("spec_drafting");

    const autoAdvanceRules = resolveEffectiveRules({
      prompt: {
        autoAdvanceHardGates: true,
      },
    });
    const allowed = apply(run, { type: "approve_spec", approved: false }, 2, autoAdvanceRules);
    expect(allowed.blockedReason).toBeUndefined();
    expect(allowed.nextRun.state).toBe("spec_approved");
  });

  it("supports initialization bundled approval gate action", () => {
    const run = inState("intake");
    const blocked = apply(run, { type: "approve_initialization_bundle", approved: false }, 1);
    expect(blocked.blockedReason).toContain("hard gate");

    const approved = apply(run, { type: "approve_initialization_bundle", approved: true }, 2);
    expect(approved.blockedReason).toBeUndefined();
    expect(approved.nextRun.state).toBe("intake");
  });

  it("returns to rework when completion is attempted with unresolved failed gates without force", () => {
    const run: WorkflowRun = {
      ...inState("ready_to_complete"),
      unresolvedFailedGates: ["lint"],
      metadata: {
        syncPreviewApprovedAt: time(1),
      },
    };

    const reworked = apply(run, { type: "sync_succeeded" }, 2);
    expect(reworked.blockedReason).toBeUndefined();
    expect(reworked.nextRun.state).toBe("rework");

    const forced = apply(
      run,
      {
        type: "request_force_completion",
        reason: "accept known lint debt",
        approvedBy: "alice",
      },
      3,
    );
    expect(forced.nextRun.forceCompletionRequested).toBe(true);

    const blockedWithoutReapproval = apply(forced.nextRun, { type: "sync_succeeded" }, 4);
    expect(blockedWithoutReapproval.blockedReason).toContain("sync preview must be approved");

    const reapproved = apply(forced.nextRun, { type: "approve_sync_preview", approved: true }, 5);
    const completed = apply(reapproved.nextRun, { type: "sync_succeeded" }, 6);
    expect(completed.blockedReason).toBeUndefined();
    expect(completed.nextRun.state).toBe("completed");
  });

  it("prevents transitions from terminal states", () => {
    const run = inState("completed");
    const blocked = apply(run, { type: "cancel_workflow", reason: "too late" }, 1);

    expect(blocked.blockedReason).toContain("terminal");
    expect(blocked.nextRun.state).toBe("completed");
  });

  it("requires user actor for force completion requests", () => {
    const run: WorkflowRun = {
      ...inState("ready_to_complete"),
      unresolvedFailedGates: ["lint"],
    };

    const blocked = transitionWorkflow({
      run,
      action: {
        type: "request_force_completion",
        reason: "accept known lint debt",
        approvedBy: "agent",
      },
      nowIso: time(1),
      rules,
      actor: { kind: "agent", id: "codex" },
    });

    expect(blocked.blockedReason).toContain("explicit user command");
    expect(blocked.nextRun.forceCompletionRequested).toBe(false);
  });
});
