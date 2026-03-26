export type DriftStrategy = "merge-main" | "rebase-main";

export interface RuleSet {
  validationChecks?: string[];
  branchNamingPattern?: string;
  driftStrategy?: DriftStrategy;
  autoAdvanceHardGates?: boolean;
  allowAutoCancel?: boolean;
  allowAutoSyncRetry?: boolean;
}

export type RuleSourceName = "prompt" | "constitution" | "agentsMd" | "readmeMd";

export interface RuleSources {
  prompt?: RuleSet;
  constitution?: RuleSet;
  agentsMd?: RuleSet;
  readmeMd?: RuleSet;
}

export interface EffectiveRules {
  validationChecks: string[];
  branchNamingPattern: string;
  driftStrategy: DriftStrategy;
  autoAdvanceHardGates: boolean;
  allowAutoCancel: boolean;
  allowAutoSyncRetry: boolean;
}

export interface ResolvedRule<TValue> {
  value: TValue;
  source: RuleSourceName | "default";
}

export interface ResolvedRulesWithSource {
  validationChecks: ResolvedRule<string[]>;
  branchNamingPattern: ResolvedRule<string>;
  driftStrategy: ResolvedRule<DriftStrategy>;
  autoAdvanceHardGates: ResolvedRule<boolean>;
  allowAutoCancel: ResolvedRule<boolean>;
  allowAutoSyncRetry: ResolvedRule<boolean>;
}
