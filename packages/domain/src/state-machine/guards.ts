import type { DomainAction, WorkflowState } from "@specforge/contracts";
import { STATE_TRANSITIONS } from "./transitions.js";

export function nextStateForAction(
  currentState: WorkflowState,
  actionType: DomainAction["type"],
): WorkflowState | null {
  const transitionsForState = STATE_TRANSITIONS[currentState];
  const nextState = transitionsForState?.[actionType];
  return nextState ?? null;
}

export function canTransition(currentState: WorkflowState, actionType: DomainAction["type"]): boolean {
  return nextStateForAction(currentState, actionType) !== null;
}

export function transitionGuard(
  currentState: WorkflowState,
  actionType: DomainAction["type"],
): { allowed: boolean; reason?: string } {
  const nextState = nextStateForAction(currentState, actionType);
  if (nextState === null) {
    return {
      allowed: false,
      reason: `invalid transition: ${currentState} -> ${actionType}`,
    };
  }
  return {
    allowed: true,
  };
}
