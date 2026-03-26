import type {
  EffectiveRules,
  ResolvedRule,
  ResolvedRulesWithSource,
  RuleSet,
  RuleSourceName,
  RuleSources,
} from "@specforge/contracts";

export const DEFAULT_EFFECTIVE_RULES: EffectiveRules = {
  validationChecks: [],
  branchNamingPattern: "sf/{workType}/{slug}",
  driftStrategy: "merge-main",
  autoAdvanceHardGates: false,
  allowAutoCancel: false,
  allowAutoSyncRetry: false,
};

const PRECEDENCE: RuleSourceName[] = ["prompt", "constitution", "agentsMd", "readmeMd"];

type EffectiveRuleField = keyof EffectiveRules;

function cloneRuleValue<TValue>(value: TValue): TValue {
  if (Array.isArray(value)) {
    return [...value] as TValue;
  }
  return value;
}

function resolveRuleField<TField extends EffectiveRuleField>(
  sources: RuleSources,
  field: TField,
  fallback: EffectiveRules[TField],
): ResolvedRule<EffectiveRules[TField]> {
  for (const sourceName of PRECEDENCE) {
    const source = sources[sourceName] as RuleSet | undefined;
    if (source === undefined) {
      continue;
    }
    const value = source[field as keyof RuleSet] as EffectiveRules[TField] | undefined;
    if (value !== undefined) {
      return {
        value: cloneRuleValue(value),
        source: sourceName,
      };
    }
  }
  return {
    value: cloneRuleValue(fallback),
    source: "default",
  };
}

export function resolveEffectiveRulesWithSource(sources: RuleSources): ResolvedRulesWithSource {
  return {
    validationChecks: resolveRuleField(sources, "validationChecks", DEFAULT_EFFECTIVE_RULES.validationChecks),
    branchNamingPattern: resolveRuleField(
      sources,
      "branchNamingPattern",
      DEFAULT_EFFECTIVE_RULES.branchNamingPattern,
    ),
    driftStrategy: resolveRuleField(sources, "driftStrategy", DEFAULT_EFFECTIVE_RULES.driftStrategy),
    autoAdvanceHardGates: resolveRuleField(
      sources,
      "autoAdvanceHardGates",
      DEFAULT_EFFECTIVE_RULES.autoAdvanceHardGates,
    ),
    allowAutoCancel: resolveRuleField(sources, "allowAutoCancel", DEFAULT_EFFECTIVE_RULES.allowAutoCancel),
    allowAutoSyncRetry: resolveRuleField(
      sources,
      "allowAutoSyncRetry",
      DEFAULT_EFFECTIVE_RULES.allowAutoSyncRetry,
    ),
  };
}

export function resolveEffectiveRules(sources: RuleSources): EffectiveRules {
  const resolved = resolveEffectiveRulesWithSource(sources);
  return {
    validationChecks: resolved.validationChecks.value,
    branchNamingPattern: resolved.branchNamingPattern.value,
    driftStrategy: resolved.driftStrategy.value,
    autoAdvanceHardGates: resolved.autoAdvanceHardGates.value,
    allowAutoCancel: resolved.allowAutoCancel.value,
    allowAutoSyncRetry: resolved.allowAutoSyncRetry.value,
  };
}
