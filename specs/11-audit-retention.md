# Spec: Audit, History, and Retention

- Feature slug: `audit-retention`
- Short feature description: Preserve traceable workflow history with secret-safe logs and defined retention behavior for completed and cancelled runs.

## User Stories

### US-AR-01: Keep auditable workflow history

As a software engineer, I want domain events recorded so process and decisions are reconstructable later.

Acceptance Criteria:

- Given any workflow transition or key action, when it occurs, then corresponding domain event is recorded.
- Given completed workflow, when I inspect history, then event trail explains what happened and when.

### US-AR-02: Log prompts safely

As a software engineer, I want prompt/action logs preserved with secret masking so sensitive values are not leaked.

Acceptance Criteria:

- Given user prompt/action is logged, when persisted, then secret masking is applied.
- Given audit review, when reading stored prompt/action text, then masked output is visible.

### US-AR-03: Apply lifecycle-based retention

As a software engineer, I want different retention rules for completed versus cancelled workflows.

Acceptance Criteria:

- Given workflow completes, when history is preserved, then per-run artifacts are removed by default unless user requested retention.
- Given workflow is cancelled, when finalizing cancellation, then only minimal cancellation metadata is kept.

## Functional Requirements

- FR-AR-001: SpecForge shall record core domain events for workflow lifecycle, approvals, sync, drift, conflicts, and retry/override actions.
- FR-AR-002: SpecForge shall log user prompts/actions relevant to workflow execution with automatic secret masking.
- FR-AR-003: Prompt/action log retention shall apply to normal/completed workflow audit trails.
- FR-AR-004: Section-lock events shall not be part of MVP event model.
- FR-AR-005: PR-failure-specific audit event shall not be required in MVP.
- FR-AR-006: Cancellation shall be terminal.
- FR-AR-007: Cancellation retention shall keep only minimal metadata: `branch_name`, `work_type`, `initiator`, `created_at`, `cancelled_at`, `cancellation_reason`, `last_state`, `affected_section_ids`, `branch_head_sha`, and `branch_exists`.
- FR-AR-008: After workflow completion, per-run artifacts shall be removed by default after history is preserved.
- FR-AR-009: User may explicitly request to keep per-run artifacts after completion.
- FR-AR-010: After cancellation, per-run artifacts shall not be retained.
