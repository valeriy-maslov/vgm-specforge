import type {
  Actor,
  AuditEvent,
  DomainAction,
  DomainEventName,
  EffectiveRules,
  HardGateRuleAuditPayload,
  WorkflowRun,
  WorkflowState,
} from "@specforge/contracts";
import { isForceCompletionRequired } from "../policies/force-completion.js";
import { canAdvanceHardGate, hardGateBlockedReason, hardGateForAction } from "../policies/hard-gates.js";
import { isTerminalState } from "./states.js";

type ActionType = DomainAction["type"];

type TransitionMap = Record<WorkflowState, Partial<Record<ActionType, WorkflowState>>>;

const SYSTEM_ACTOR: Actor = { kind: "system", id: "specforge-domain" };

export interface TransitionInput {
  run: WorkflowRun;
  action: DomainAction;
  nowIso: string;
  rules: EffectiveRules;
  hardGateAudit?: HardGateRuleAuditPayload;
  actor?: Actor;
  eventIdFactory?: () => string;
}

export interface TransitionResult {
  nextRun: WorkflowRun;
  events: AuditEvent[];
  blockedReason?: string;
}

export const STATE_TRANSITIONS: TransitionMap = {
  intake: {
    approve_initialization_bundle: "intake",
    confirm_scope: "scope_confirmed",
    cancel_workflow: "cancelled",
  },
  scope_confirmed: {
    start_spec_drafting: "spec_drafting",
    cancel_workflow: "cancelled",
  },
  spec_drafting: {
    start_spec_drafting: "spec_drafting",
    approve_spec: "spec_approved",
    cancel_workflow: "cancelled",
  },
  spec_approved: {
    start_plan_drafting: "plan_drafting",
    cancel_workflow: "cancelled",
  },
  plan_drafting: {
    start_plan_drafting: "plan_drafting",
    approve_plan: "plan_approved",
    cancel_workflow: "cancelled",
  },
  plan_approved: {
    start_implementation: "implementing",
    cancel_workflow: "cancelled",
  },
  implementing: {
    complete_implementation: "validation",
    cancel_workflow: "cancelled",
  },
  validation: {
    validation_decision: "ready_to_complete",
    cancel_workflow: "cancelled",
  },
  rework: {
    apply_rework: "implementing",
    cancel_workflow: "cancelled",
  },
  ready_to_complete: {
    approve_sync_preview: "ready_to_complete",
    request_sync_retry: "ready_to_complete",
    request_force_completion: "ready_to_complete",
    sync_failed: "ready_to_complete",
    sync_succeeded: "completed",
    cancel_workflow: "cancelled",
  },
  completed: {},
  cancelled: {},
};

export function transitionWorkflow(input: TransitionInput): TransitionResult {
  if (isTerminalState(input.run.state)) {
    return {
      nextRun: input.run,
      events: [],
      blockedReason: `workflow is terminal in state '${input.run.state}'`,
    };
  }

  const policyBlockedReason = enforceActionPolicies(input);
  if (policyBlockedReason !== null) {
    return {
      nextRun: input.run,
      events: [],
      blockedReason: policyBlockedReason,
    };
  }

  const gate = hardGateForAction(input.action);
  if (gate !== null) {
    const approved = actionApprovalValue(input.action);
    if (!canAdvanceHardGate({ approved, rules: input.rules })) {
      return {
        nextRun: input.run,
        events: [],
        blockedReason: hardGateBlockedReason(gate),
      };
    }
  }

  const nextState = resolveTransitionTarget(input.run, input.action.type);
  if (nextState === null) {
    return {
      nextRun: input.run,
      events: [],
      blockedReason: `invalid transition: ${input.run.state} -> ${input.action.type}`,
    };
  }

  const nextRun = applyActionEffects(input.run, input.action, nextState, input.nowIso);
  const actor = input.actor ?? SYSTEM_ACTOR;
  const eventIdFactory = input.eventIdFactory ?? createEventIdFactory(input.run.key.branchName, input.nowIso);
  const eventTypes = eventTypesForAction(input.action, nextState);
  const payload = buildEventPayload(input.action, input.run.state, nextState, nextRun, input.hardGateAudit);

  const events: AuditEvent[] = eventTypes.map((eventType) => ({
    id: eventIdFactory(),
    run: input.run.key,
    type: eventType,
    actor,
    createdAt: input.nowIso,
    payload,
  }));

  return {
    nextRun,
    events,
  };
}

function resolveTransitionTarget(run: WorkflowRun, actionType: ActionType): WorkflowState | null {
  const transitionsForState = STATE_TRANSITIONS[run.state];
  const nextState = transitionsForState?.[actionType];
  if (nextState === undefined) {
    return null;
  }

  if (
    actionType === "sync_succeeded" &&
    isForceCompletionRequired({
      unresolvedFailedGates: run.unresolvedFailedGates,
      explicitForceCommand: run.forceCompletionRequested,
    })
  ) {
    return "rework";
  }

  return nextState;
}

function actionApprovalValue(action: DomainAction): boolean | undefined {
  switch (action.type) {
    case "approve_initialization_bundle":
    case "approve_spec":
    case "approve_plan":
    case "approve_sync_preview":
    case "validation_decision":
      return action.approved;
    default:
      return undefined;
  }
}

function enforceActionPolicies(input: TransitionInput): string | null {
  if (input.action.type === "cancel_workflow" && input.actor?.kind === "agent" && !input.rules.allowAutoCancel) {
    return "agent-triggered cancellation is disabled by active rules";
  }

  if (
    input.action.type === "request_sync_retry" &&
    input.actor?.kind === "agent" &&
    !input.rules.allowAutoSyncRetry
  ) {
    return "agent-triggered sync retry is disabled by active rules";
  }

  if (input.action.type === "request_force_completion" && input.action.reason.trim().length === 0) {
    return "force completion reason is required";
  }

  if (input.action.type === "request_force_completion" && input.actor?.kind !== "user") {
    return "force completion requires explicit user command";
  }

  if (input.action.type === "sync_succeeded" && !isSyncPreviewApproved(input.run)) {
    return "sync preview must be approved before sync completes";
  }

  return null;
}

function applyActionEffects(
  run: WorkflowRun,
  action: DomainAction,
  nextState: WorkflowState,
  nowIso: string,
): WorkflowRun {
  let nextRun: WorkflowRun = {
    ...run,
    state: nextState,
    updatedAt: nowIso,
  };

  switch (action.type) {
    case "confirm_scope": {
      nextRun = {
        ...nextRun,
        affectedSectionIds: uniqueNonEmpty(action.affectedSectionIds),
      };
      break;
    }
    case "validation_decision": {
      nextRun = {
        ...nextRun,
        state: action.decision === "changes_requested" ? "rework" : "ready_to_complete",
        unresolvedFailedGates: uniqueNonEmpty(action.unresolvedFailedGates),
      };
      break;
    }
    case "approve_sync_preview": {
      nextRun = {
        ...nextRun,
        metadata: mergeMetadata(nextRun.metadata, {
          syncPreviewApprovedAt: nowIso,
        }),
      };
      break;
    }
    case "request_sync_retry": {
      nextRun = {
        ...nextRun,
        metadata: mergeMetadata(nextRun.metadata, {
          syncRetryRequestedAt: nowIso,
        }),
      };
      break;
    }
    case "request_force_completion": {
      const metadataWithoutPreviewApproval = removeMetadataKeys(nextRun.metadata, ["syncPreviewApprovedAt"]);
      nextRun = {
        ...nextRun,
        forceCompletionRequested: true,
        metadata: mergeMetadata(metadataWithoutPreviewApproval, {
          forceCompletionReason: action.reason,
          forceCompletionApprovedBy: action.approvedBy,
          forceCompletionRequestedAt: nowIso,
        }),
      };
      break;
    }
    case "sync_failed": {
      nextRun = {
        ...nextRun,
        metadata: mergeMetadata(nextRun.metadata, {
          lastSyncFailureReason: action.reason,
          lastSyncFailureAt: nowIso,
        }),
      };
      break;
    }
    case "cancel_workflow": {
      nextRun = {
        ...nextRun,
        unresolvedFailedGates: [],
        forceCompletionRequested: false,
        cancelledAt: nowIso,
        metadata: {
          cancellationReason: action.reason,
        },
      };
      break;
    }
    default:
      break;
  }

  if (nextRun.state === "completed") {
    nextRun = {
      ...nextRun,
      completedAt: nowIso,
    };
  }

  return nextRun;
}

function mergeMetadata(
  metadata: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    ...patch,
  };
}

function removeMetadataKeys(
  metadata: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> {
  const nextMetadata = {
    ...(metadata ?? {}),
  };

  for (const key of keys) {
    delete nextMetadata[key];
  }

  return nextMetadata;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function isSyncPreviewApproved(run: WorkflowRun): boolean {
  return typeof run.metadata?.syncPreviewApprovedAt === "string";
}

function createEventIdFactory(prefix: string, nowIso: string): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}:${nowIso}:${sequence}`;
  };
}

function eventTypesForAction(action: DomainAction, nextState: WorkflowState): DomainEventName[] {
  switch (action.type) {
    case "approve_initialization_bundle":
      return [];
    case "confirm_scope":
      return ["scope_confirmed"];
    case "start_spec_drafting":
      return ["spec_generated"];
    case "approve_spec":
      return ["spec_approved"];
    case "start_plan_drafting":
      return ["plan_generated"];
    case "approve_plan":
      return ["plan_approved"];
    case "start_implementation":
      return ["implementation_started"];
    case "complete_implementation":
      return ["implementation_completed"];
    case "validation_decision":
      return [action.decision === "accepted" ? "validation_accepted" : "validation_changes_requested"];
    case "apply_rework":
      return ["implementation_started"];
    case "approve_sync_preview":
      return ["sync_preview_approved"];
    case "request_sync_retry":
      return ["sync_retry_requested"];
    case "request_force_completion":
      return ["force_completion_requested"];
    case "sync_failed":
      return ["sync_failed"];
    case "sync_succeeded":
      if (nextState === "completed") {
        return ["master_docs_synced", "workflow_completed"];
      }
      return ["completion_triggered"];
    case "cancel_workflow":
      return ["workflow_cancelled"];
    default:
      return ["completion_triggered"];
  }
}

function buildEventPayload(
  action: DomainAction,
  previousState: WorkflowState,
  nextState: WorkflowState,
  nextRun: WorkflowRun,
  hardGateAudit?: HardGateRuleAuditPayload,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    action: action.type,
    previousState,
    nextState,
    affectedSectionIds: nextRun.affectedSectionIds,
    unresolvedFailedGates: nextRun.unresolvedFailedGates,
  };

  if (hardGateAudit !== undefined) {
    payload.hardGate = hardGateAudit.gate;
    payload.appliedRuleSources = hardGateAudit.appliedSources;
    payload.effectiveRulesSnapshot = hardGateAudit.effectiveRulesSnapshot;
  }

  switch (action.type) {
    case "validation_decision":
      payload.validationDecision = action.decision;
      break;
    case "request_force_completion":
      payload.reason = action.reason;
      payload.approvedBy = action.approvedBy;
      break;
    case "sync_failed":
      payload.reason = action.reason;
      break;
    case "cancel_workflow":
      payload.reason = action.reason;
      break;
    default:
      break;
  }

  return payload;
}
