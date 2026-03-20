# Spec: Completion, Sync, and Force Completion

- Feature slug: `completion-sync-force`
- Short feature description: Finalize workflows through previewed, user-approved, atomic master-doc synchronization with explicit force-completion handling.

## User Stories

### US-CS-01: Review sync impact before applying

As a software engineer, I want a final sync preview so I can verify exactly what master docs and logs will change.

Acceptance Criteria:

- Given workflow is `ready_to_complete`, when sync preview is generated, then it lists all create/update operations for master docs and history.
- Given preview is shown, when I do not approve it, then sync does not execute.

### US-CS-02: Execute atomic sync

As a software engineer, I want all master updates applied atomically so no partial source-of-truth state is produced.

Acceptance Criteria:

- Given approved preview, when sync runs successfully, then all listed updates are applied as one transaction.
- Given sync fails technically, when execution stops, then no partial update is accepted and workflow stays in `ready_to_complete`.

### US-CS-03: Complete with explicit override when needed

As a software engineer, I want force completion to be explicit and fully documented when unresolved failed gates are intentionally overridden.

Acceptance Criteria:

- Given unresolved failed gates, when force completion is requested, then preview includes reason, overridden gates, and risk acceptance.
- Given no explicit force completion command, when unresolved failed gates exist, then completion is blocked.

## Functional Requirements

- FR-CS-001: Before sync, SpecForge shall generate final sync preview.
- FR-CS-002: Sync preview shall include master docs to create/update, master feature specs to create/update, Root Master Spec index updates, Decision Log promotions, and history/audit persistence entries.
- FR-CS-003: Final sync preview approval shall be a hard gate.
- FR-CS-004: Completion/sync shall be atomic all-or-nothing.
- FR-CS-005: On first sync, SpecForge shall create missing master docs and apply updates in one atomic operation.
- FR-CS-006: Sync operation shall support multiple master feature spec updates/creates in one workflow run.
- FR-CS-007: Decision List entries shall be promoted to Master Decision Log only during final completion/sync.
- FR-CS-008: On sync technical failure, workflow shall remain in `ready_to_complete`, report failure, and allow user-triggered retry.
- FR-CS-009: Retry after sync failure shall be user-triggered by default.
- FR-CS-010: Force completion shall require explicit user command.
- FR-CS-011: Force-completion preview shall include explicit command context, reason/justification, list of overridden failed gates, and risk acceptance (who and when).
- FR-CS-012: For refactor workflows, default sync shall update architecture, implementation, decision log, and history docs, while feature specs are updated only if impact is detected or user explicitly requests it.
- FR-CS-013: Workflow state shall transition to `completed` only after successful sync.
