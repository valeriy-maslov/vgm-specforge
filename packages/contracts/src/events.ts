import type { RuleSourceName } from "./rules.js";
import type { Actor, HardGate, WorkflowRunKey } from "./workflow.js";

export const DOMAIN_EVENT_NAMES = [
  "workflow_started",
  "scope_proposed",
  "scope_confirmed",
  "spec_generated",
  "spec_approved",
  "plan_generated",
  "plan_approved",
  "implementation_started",
  "implementation_completed",
  "validation_accepted",
  "validation_changes_requested",
  "completion_triggered",
  "sync_preview_generated",
  "sync_preview_approved",
  "master_docs_sync_started",
  "master_docs_synced",
  "workflow_completed",
  "workflow_cancelled",
  "drift_detected",
  "main_merge_started",
  "main_merge_completed",
  "merge_conflict_detected",
  "merge_conflict_resolution_proposed",
  "merge_conflict_resolution_approved",
  "merge_conflict_resolution_applied",
  "force_completion_requested",
  "sync_failed",
  "sync_retry_requested",
] as const;

export type DomainEventName = (typeof DOMAIN_EVENT_NAMES)[number];

export interface AuditEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  run: WorkflowRunKey;
  type: DomainEventName;
  actor: Actor;
  createdAt: string;
  payload: TPayload;
}

export interface EventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  event: AuditEvent<TPayload>;
  requestId?: string;
  correlationId?: string;
}

export interface AppliedRuleSource {
  source: RuleSourceName | "default";
  keys: string[];
}

export interface HardGateRuleAuditPayload {
  gate: HardGate;
  appliedSources: AppliedRuleSource[];
  effectiveRulesSnapshot: Record<string, unknown>;
}
