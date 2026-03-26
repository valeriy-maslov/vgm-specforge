import type { DomainAction, EffectiveRules, HardGate } from "@specforge/contracts";

const ACTION_TO_HARD_GATE: Partial<Record<DomainAction["type"], HardGate>> = {
  approve_initialization_bundle: "initialization_bundled_approval",
  approve_spec: "spec_approval",
  approve_plan: "plan_approval",
  validation_decision: "validation_decision",
  approve_sync_preview: "final_sync_preview_approval",
};

const HARD_GATES = new Set<HardGate>([
  "initialization_bundled_approval",
  "spec_approval",
  "plan_approval",
  "validation_decision",
  "final_sync_preview_approval",
]);

export function hardGateForAction(action: DomainAction): HardGate | null {
  return ACTION_TO_HARD_GATE[action.type] ?? null;
}

export function requiresHardGateApproval(actionOrGate: DomainAction | HardGate): boolean {
  if (typeof actionOrGate === "string") {
    return HARD_GATES.has(actionOrGate);
  }
  return hardGateForAction(actionOrGate) !== null;
}

export function canAdvanceHardGate(args: { approved: boolean | undefined; rules: EffectiveRules }): boolean {
  return args.approved === true || args.rules.autoAdvanceHardGates;
}

export function hardGateBlockedReason(gate: HardGate): string {
  return `hard gate '${gate}' requires explicit approval`;
}
