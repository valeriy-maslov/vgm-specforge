import type {
  AppliedRuleSource,
  EffectiveRules,
  HardGate,
  HardGateRuleAuditPayload,
  RuleSources,
} from "@specforge/contracts";
import { resolveEffectiveRulesWithSource } from "@specforge/domain";

const EFFECTIVE_RULE_FIELDS: ReadonlyArray<keyof EffectiveRules> = [
  "validationChecks",
  "branchNamingPattern",
  "driftStrategy",
  "autoAdvanceHardGates",
  "allowAutoCancel",
  "allowAutoSyncRetry",
];

export interface RuleEvaluationResult {
  effectiveRules: EffectiveRules;
  appliedSources: AppliedRuleSource[];
}

export function evaluateRules(sources: RuleSources = {}): RuleEvaluationResult {
  const resolved = resolveEffectiveRulesWithSource(sources);

  const effectiveRules: EffectiveRules = {
    validationChecks: resolved.validationChecks.value,
    branchNamingPattern: resolved.branchNamingPattern.value,
    driftStrategy: resolved.driftStrategy.value,
    autoAdvanceHardGates: resolved.autoAdvanceHardGates.value,
    allowAutoCancel: resolved.allowAutoCancel.value,
    allowAutoSyncRetry: resolved.allowAutoSyncRetry.value,
  };

  const sourceToKeys = new Map<AppliedRuleSource["source"], Set<string>>();
  for (const field of EFFECTIVE_RULE_FIELDS) {
    const source = resolved[field].source;
    const existing = sourceToKeys.get(source);
    if (existing !== undefined) {
      existing.add(field);
      continue;
    }
    sourceToKeys.set(source, new Set([field]));
  }

  const appliedSources: AppliedRuleSource[] = [...sourceToKeys.entries()]
    .map(([source, keys]) => ({
      source,
      keys: [...keys].sort(),
    }))
    .sort((left, right) => left.source.localeCompare(right.source));

  return {
    effectiveRules,
    appliedSources,
  };
}

export function evaluateHardGateRules(gate: HardGate, sources: RuleSources = {}): HardGateRuleAuditPayload {
  const evaluation = evaluateRules(sources);
  return {
    gate,
    appliedSources: evaluation.appliedSources,
    effectiveRulesSnapshot: {
      ...evaluation.effectiveRules,
    },
  };
}
