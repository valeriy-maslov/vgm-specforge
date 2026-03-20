# Spec: Workflow State Machine

- Feature slug: `workflow-state-machine`
- Short feature description: Provide one unified state machine for feature, refinement, and refactor workflows with explicit lifecycle states and transition rules.

## User Stories

### US-WS-01: Run one consistent workflow model

As a software engineer, I want a single lifecycle model for all work types so process behavior is predictable.

Acceptance Criteria:

- Given any new workflow, when type is inferred, then it maps to `feature`, `refinement`, or `refactor` and follows the same state machine.
- Given `refactor`, when workflow runs, then it still includes a lightweight Work Spec before planning.

### US-WS-02: Move through explicit states

As a software engineer, I want visible workflow states so I can always understand current progress.

Acceptance Criteria:

- Given an active workflow, when I inspect status, then current state is one of the canonical states.
- Given user requests changes during validation, when workflow transitions, then state moves to `rework`.

### US-WS-03: End workflow in controlled terminal states

As a software engineer, I want clear terminal outcomes so I can distinguish done versus cancelled work.

Acceptance Criteria:

- Given successful sync, when workflow ends, then state is `completed` and result is ready for human review on branch.
- Given cancellation command, when workflow ends, then state is `cancelled` and cannot be resumed.

## Functional Requirements

- FR-WS-001: SpecForge shall use one unified workflow model for `feature`, `refinement`, and `refactor`.
- FR-WS-002: Work type shall be inferred from prompt/skill/script/context input.
- FR-WS-003: Canonical states shall be `intake`, `scope_confirmed`, `spec_drafting`, `spec_approved`, `plan_drafting`, `plan_approved`, `implementing`, `validation`, `rework`, `ready_to_complete`, `completed`, and `cancelled`.
- FR-WS-004: Scope confirmation shall be required before entering spec drafting.
- FR-WS-005: Scope confirmation shall be a soft checkpoint and not a hard gate.
- FR-WS-006: SpecForge shall support iterative loops in spec drafting and plan drafting before approval gates are passed.
- FR-WS-007: Validation changes requested shall transition workflow to `rework`.
- FR-WS-008: Workflow shall return from `rework` to implementation and validation loop after approved updates are applied.
- FR-WS-009: `completed` shall mean ready for human review on branch, not merged and not deployed.
- FR-WS-010: `cancelled` shall be terminal and non-resumable.
- FR-WS-011: SpecForge shall not require a separate intake-summary approval checkpoint.
