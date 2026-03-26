# Spec: Validation and Rework

- Feature slug: `validation-rework`
- Short feature description: Run validation-stage check evaluation automatically and support controlled rework loops before completion.

## User Stories

### US-VR-01: Validate implementation with automatic checks

As a software engineer, I want validation-stage checks to be evaluated automatically according to active runtime rules so quality gates are consistently applied.

Acceptance Criteria:

- Given workflow reaches validation, when validation starts, then SpecForge records/evaluates validation checks using active runtime rule sources.
- Given checks complete, when results are shown, then user can choose `accepted` or `changes_requested`.

### US-VR-02: Iterate with rework until acceptable

As a software engineer, I want to request changes after validation and loop through updates safely.

Acceptance Criteria:

- Given I select `changes_requested`, when decision is recorded, then workflow enters `rework`.
- Given rework updates are approved where needed and implemented, when validation reruns, then workflow can continue.

### US-VR-03: Handle accepted validation with failed checks

As a software engineer, I want to accept validation with known failed checks while preserving explicit risk handling at completion.

Acceptance Criteria:

- Given validation is accepted and checks still fail, when workflow moves toward completion, then normal completion is blocked unless force completion is explicitly requested.
- Given force completion is not requested, when completion is attempted, then workflow returns to `rework`.

## Functional Requirements

- FR-VR-001: SpecForge shall automatically evaluate validation checks from active runtime rule sources at validation stage and persist validation check outcomes (MVP derives failed checks from workflow metadata and configured checks; external check execution is an extension point).
- FR-VR-002: Validation decision hard gate shall support `accepted` and `changes_requested` decisions.
- FR-VR-003: `changes_requested` shall transition workflow to `rework`.
- FR-VR-004: Rework flow in MVP shall support implementation updates through `rework -> implementing`; spec/plan redrafting can be initiated explicitly as a separate user-driven loop.
- FR-VR-005: Rework flow shall return to implementation then validation after updates are applied.
- FR-VR-006: SpecForge shall allow user to mark validation as `accepted` even when some checks fail.
- FR-VR-007: When unresolved failed gates exist, normal completion path shall be blocked unless explicit force completion command is present.
- FR-VR-008: If completion is attempted with unresolved failed gates and without force completion command, workflow shall return to `rework`.
