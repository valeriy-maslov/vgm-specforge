import type { Actor, HardGate } from "@specforge/contracts";
import type { RuleSourceName } from "@specforge/contracts";

export interface AppliedRuleTrace {
  field: string;
  source: RuleSourceName | "default";
  value: unknown;
}

export interface GateDecisionRecord {
  gate: HardGate;
  approved: boolean;
  decidedAt: string;
  decidedBy: Actor;
  appliedRules: AppliedRuleTrace[];
}
