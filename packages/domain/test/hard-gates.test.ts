import type { DomainAction } from "@specforge/contracts";
import { describe, expect, it } from "vitest";
import { canAdvanceHardGate, hardGateForAction, requiresHardGateApproval } from "../src/policies/hard-gates.js";
import { resolveEffectiveRules } from "../src/policies/rule-precedence.js";

describe("hard gate policy", () => {
  it("maps hard-gate actions to gates", () => {
    expect(hardGateForAction({ type: "approve_initialization_bundle", approved: true })).toBe(
      "initialization_bundled_approval",
    );
    expect(hardGateForAction({ type: "approve_spec", approved: true })).toBe("spec_approval");
    expect(hardGateForAction({ type: "approve_plan", approved: true })).toBe("plan_approval");
    expect(
      hardGateForAction({
        type: "validation_decision",
        decision: "accepted",
        approved: true,
        unresolvedFailedGates: [],
      }),
    ).toBe("validation_decision");
    expect(hardGateForAction({ type: "start_spec_drafting" })).toBeNull();
  });

  it("recognizes hard gate inputs", () => {
    const approveInitialization: DomainAction = { type: "approve_initialization_bundle", approved: true };
    const approveSpec: DomainAction = { type: "approve_spec", approved: true };
    const approvePlan: DomainAction = { type: "approve_plan", approved: true };
    const validationDecision: DomainAction = {
      type: "validation_decision",
      decision: "changes_requested",
      approved: true,
      unresolvedFailedGates: ["tests"],
    };
    const approveSyncPreview: DomainAction = { type: "approve_sync_preview", approved: true };
    const draftSpec: DomainAction = { type: "start_spec_drafting" };

    expect(requiresHardGateApproval(approveInitialization)).toBe(true);
    expect(requiresHardGateApproval(approveSpec)).toBe(true);
    expect(requiresHardGateApproval(approvePlan)).toBe(true);
    expect(requiresHardGateApproval(validationDecision)).toBe(true);
    expect(requiresHardGateApproval(approveSyncPreview)).toBe(true);
    expect(requiresHardGateApproval(draftSpec)).toBe(false);
    expect(requiresHardGateApproval("initialization_bundled_approval")).toBe(true);
  });

  it("requires explicit approval by default and allows prompt override", () => {
    const defaultRules = resolveEffectiveRules({});
    expect(canAdvanceHardGate({ approved: false, rules: defaultRules })).toBe(false);
    expect(canAdvanceHardGate({ approved: true, rules: defaultRules })).toBe(true);

    const overrideRules = resolveEffectiveRules({
      prompt: {
        autoAdvanceHardGates: true,
      },
    });
    expect(canAdvanceHardGate({ approved: false, rules: overrideRules })).toBe(true);
  });
});
