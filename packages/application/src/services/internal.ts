import {
  SpecforgeError,
  type AppliedRuleSource,
  type AuditDriver,
  type AuditEvent,
  type DomainEventName,
  type HardGate,
  type HardGateRuleAuditPayload,
  type RuleSourceName,
  type WorkflowRun,
  type WorkflowRunKey,
} from "@specforge/contracts";
import { evaluateHardGateRules, evaluateRules } from "../orchestration/rule-evaluation.js";
import { sanitizeRunForPersistence } from "../orchestration/secret-masking.js";

export async function loadRunOrThrow(
  auditDriver: AuditDriver,
  key: WorkflowRunKey,
  message: string,
): Promise<WorkflowRun> {
  const run = await auditDriver.getRun(key);
  if (run === null) {
    throw new SpecforgeError("INVALID_WORKFLOW_STATE", message, {
      run: key,
    });
  }
  return run;
}

export function defaultRules() {
  return evaluateRules().effectiveRules;
}

export function evaluateHardGate(sources: Parameters<typeof evaluateHardGateRules>[1], gate: HardGate) {
  const evaluation = evaluateRules(sources);
  const hardGateAudit = evaluateHardGateRules(gate, sources);

  return {
    effectiveRules: evaluation.effectiveRules,
    hardGateAudit,
    appliedRuleSources: ruleSourceNames(evaluation.appliedSources),
  };
}

export function withHardGateAudit(
  events: readonly AuditEvent[],
  options: {
    gate: HardGate;
    targetEventTypes: readonly DomainEventName[];
    hardGateAudit: HardGateRuleAuditPayload;
  },
): AuditEvent[] {
  return events.map((event) => {
    if (!options.targetEventTypes.includes(event.type)) {
      return event;
    }

    return {
      ...event,
      payload: {
        ...event.payload,
        hardGate: options.gate,
        appliedRuleSources: options.hardGateAudit.appliedSources,
        effectiveRulesSnapshot: options.hardGateAudit.effectiveRulesSnapshot,
      },
    };
  });
}

export async function saveRunSanitized(auditDriver: AuditDriver, run: WorkflowRun): Promise<void> {
  await auditDriver.saveRun(sanitizeRunForPersistence(run));
}

function isExplicitRuleSource(source: AppliedRuleSource["source"]): source is RuleSourceName {
  return source !== "default";
}

function ruleSourceNames(appliedSources: readonly AppliedRuleSource[]): RuleSourceName[] {
  const sources = appliedSources
    .map((appliedSource) => appliedSource.source)
    .filter(isExplicitRuleSource);

  return [...new Set(sources)];
}
