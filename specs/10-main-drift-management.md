# Spec: Main Branch Drift Management

- Feature slug: `main-drift-management`
- Short feature description: Detect and reconcile `main` branch drift at key checkpoints to keep workflow outputs aligned with latest baseline.

## User Stories

### US-DR-01: Detect drift before risky checkpoints

As a software engineer, I want drift checks before implementation and completion so stale assumptions are caught early.

Acceptance Criteria:

- Given workflow reaches pre-implementation checkpoint, when drift check runs, then divergence from `main` is detected.
- Given workflow reaches pre-completion checkpoint, when drift check runs, then divergence from `main` is detected.

### US-DR-02: Merge main by default with controlled overrides

As a software engineer, I want predictable drift integration defaults while keeping override flexibility.

Acceptance Criteria:

- Given drift exists, when no override is defined, then SpecForge merges `main` into workflow branch.
- Given override exists in prompt/rules, when drift is handled, then override strategy is applied.

### US-DR-03: Resolve conflicts with approval

As a software engineer, I want AI assistance with merge conflicts while retaining control over final conflict decisions.

Acceptance Criteria:

- Given merge conflict occurs, when AI analyzes conflict, then it proposes a resolution plan.
- Given I approve proposed resolution, when AI executes, then conflict resolution is applied.

## Functional Requirements

- FR-DR-001: SpecForge shall run drift detection before implementation stage.
- FR-DR-002: SpecForge shall run drift detection before completion stage.
- FR-DR-003: If drift is detected and no override exists, default strategy shall be merge `main` into workflow branch.
- FR-DR-004: Drift strategy shall be overridable by prompt or project rules under global precedence.
- FR-DR-005: After drift integration, SpecForge shall run impact analysis against current spec, plan, and implementation context.
- FR-DR-006: SpecForge shall require user confirmation on how to proceed after impact analysis.
- FR-DR-007: If misalignment is detected after drift analysis, workflow shall transition to `rework`.
- FR-DR-008: If merge conflicts occur, SpecForge shall generate conflict-resolution proposal.
- FR-DR-009: Conflict-resolution proposal shall require user approval before application.
- FR-DR-010: After approval, SpecForge shall apply the conflict resolution.
