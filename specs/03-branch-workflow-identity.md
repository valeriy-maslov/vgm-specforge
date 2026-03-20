# Spec: Branch and Workflow Identity

- Feature slug: `branch-workflow-identity`
- Short feature description: Use Git branch identity as workflow identity with clear naming rules and branch-level concurrency constraints.

## User Stories

### US-BI-01: Use branch name as workflow identifier

As a software engineer, I want workflow identity to map directly to my branch so workflow context is simple and traceable.

Acceptance Criteria:

- Given workflow intake starts, when workflow is created, then branch is created and branch name becomes workflow ID.
- Given reused branch names across time, when viewing history, then each run remains unique by branch name plus timestamp.

### US-BI-02: Enforce one active workflow per branch

As a software engineer, I want to avoid overlapping runs in a single branch so workflow state remains deterministic.

Acceptance Criteria:

- Given one active workflow on branch X, when another workflow start is attempted on branch X, then start is ignored.
- Given ignored start, when command returns, then user sees a message that branch already has active workflow.

### US-BI-03: Use default naming but allow overrides

As a software engineer, I want practical default branch naming with optional governance overrides.

Acceptance Criteria:

- Given generated branch naming, when no override exists, then naming follows `sf/<work-type>/<short-slug>`.
- Given duplicate generated name, when new branch is generated, then autoincrement suffix is appended.
- Given naming rules in prompt or project docs, when present, then precedence rules apply.

## Functional Requirements

- FR-BI-001: SpecForge shall create workflow branch at intake.
- FR-BI-002: SpecForge shall treat branch name as workflow ID.
- FR-BI-003: SpecForge shall allow branch name reuse across different runs.
- FR-BI-004: Workflow historical uniqueness shall be represented by `(branch_name + timestamp)`.
- FR-BI-005: Default generated branch naming shall be `sf/<work-type>/<short-slug>`.
- FR-BI-006: If generated branch name collides, SpecForge shall append autoincrement suffix `-2`, `-3`, and so on.
- FR-BI-007: Branch naming convention shall be overridable by prompt and project rule sources under global precedence.
- FR-BI-008: SpecForge shall allow only one active workflow per branch.
- FR-BI-009: If start is attempted on branch with active workflow, SpecForge shall ignore the attempt and show a user-facing message.
- FR-BI-010: SpecForge shall allow parallel active workflows across different branches.
- FR-BI-011: SpecForge shall not auto-delete branches on completion.
- FR-BI-012: SpecForge shall not auto-delete branches on cancellation.
