import { TERMINAL_WORKFLOW_STATES, WORKFLOW_STATES, type WorkflowState } from "@specforge/contracts";

const terminalStates = new Set<WorkflowState>(TERMINAL_WORKFLOW_STATES);

export const ACTIVE_WORKFLOW_STATES = WORKFLOW_STATES.filter(
  (state: WorkflowState) => !terminalStates.has(state),
) as ReadonlyArray<WorkflowState>;

export function isTerminalState(state: WorkflowState): boolean {
  return terminalStates.has(state);
}

export function isActiveWorkflowState(state: WorkflowState): boolean {
  return !isTerminalState(state);
}
