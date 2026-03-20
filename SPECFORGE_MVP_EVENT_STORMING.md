# SpecForge MVP Event Storming Results

Date: 2026-03-19

This document captures the agreed outcome of the interactive event storming session for SpecForge MVP.

## 1) Goal and Product Context

- Product: SpecForge
- Goal: framework for spec-driven development with AI agents
- MVP agents: OpenCode, Codex, Claude
- Target users: software engineers building enterprise-grade software with AI agents
- Core philosophy: ideas -> specs -> plans -> implementation -> continuous refinement/refactoring, while keeping specs current, decisions documented, and history traceable

Primary user outcome for MVP:

- Deliver production-ready working code, with synchronized master docs and auditable history

## 2) Workflow Entry and Exit

### 2.1 Start Triggers

Two initialization triggers:

1. Initialize SpecForge for a new project
2. Initialize SpecForge for an existing codebase

No feature/refinement/refactor workflow may start before initialization is completed and approved.

### 2.2 Completion Meaning

`workflow_completed` means:

- Work is ready for human review on the workflow branch
- Not merged to main by default
- Not deployed by default

## 3) Rule Sources and Precedence

All three project sources are used:

- SpecForge Project Constitution
- `AGENTS.md`
- `README.md`

Precedence:

1. User prompt/instruction (highest)
2. Project Constitution
3. `AGENTS.md`
4. `README.md`

Rule re-evaluation behavior:

- AI re-evaluates applicable rules from these sources only at hard gates
- AI logs which rules and sources were applied at those hard gates

## 4) Initialization Workflow

### 4.1 Common Initialization Intent

For both new and existing projects, initialization defines:

- High-level project information
- Development constitution/governance

### 4.2 New Project Initialization

- Inputs are primarily user-provided
- Artifacts generated/updated for MVP:
  - `README.md`
  - `AGENTS.md`
  - Project Constitution (mandatory)
  - Root Master Spec (mandatory)

### 4.3 Existing Project Initialization

- AI scans current codebase and considers user instructions
- If scanned reality and docs disagree, a baseline reconciliation report is mandatory
- User must approve reconciliation before initialization can complete
- Artifacts generated/updated for MVP:
  - `AGENTS.md` only if missing
  - Project Constitution (mandatory)
  - Root Master Spec (mandatory)
  - `README.md` may be used as context but is not forced as new output

### 4.4 Initialization Approval Model

- Single bundled approval gate for initialization outputs
- If user requests changes, AI updates artifacts and repeats bundled approval loop

## 5) Master Documentation Model

### 5.1 Root and Feature Specs

- Root Master Spec is an umbrella document
- Root Master Spec contains an index of master feature specs
- Master feature specs may be split across multiple files

### 5.2 Canonical Master Docs

Canonical master docs for synchronization:

- Root Master Spec
- Master Feature Specs (one or many)
- Master Architecture Doc
- Master Implementation Doc
- Master Decision Log
- Change History

Section-ID requirement:

- Stable unique section IDs are required across all master docs
- Missing IDs must be auto-generated during initialization

Creation timing:

- Initialization must create Root Master Spec
- Other master docs are created on completion/sync when first needed

On first sync, missing master docs are created and updated in one atomic operation.

## 6) Unified Day-to-Day Workflow

### 6.1 Work Types

Unified workflow with inferred work type:

- `feature`
- `refinement`
- `refactor`

Work type and intake details are inferred from prompt/skill/script/context. A strict intake form is not required.

There is no mandatory separate intake-summary approval step. AI can proceed to spec drafting directly.

### 6.2 Required Scope Behavior

- Scope confirmation is required for all work types before spec drafting
- Scope confirmation is a soft checkpoint (not a hard gate)
- For free-text requests, AI proposes impacted section IDs/areas and user confirms/corrects scope
- For refinement/refactor, strict section references are supported and encouraged; free text is also supported

### 6.3 Workflow States

Agreed canonical states:

- `intake`
- `scope_confirmed`
- `spec_drafting`
- `spec_approved`
- `plan_drafting`
- `plan_approved`
- `implementing`
- `validation`
- `rework`
- `ready_to_complete`
- `completed`
- `cancelled`

### 6.4 Hard Gates (exact set)

Hard gates are exactly:

1. Initialization bundled approval
2. Spec approval
3. Plan approval
4. Validation decision (`accepted` or `changes_requested`)
5. Final sync preview approval

`scope_confirmed` is intentionally not a hard gate.

Hard-gate control rule:

- By default, AI must not auto-advance through hard gates without explicit user approval
- User may explicitly request different behavior in prompt/rules when desired

### 6.5 Core Stage Flow

Baseline stage flow:

1. Intake
2. Scope confirmation (soft)
3. Spec drafting and user revision loop
4. Spec approval (hard gate)
5. Plan drafting and user revision loop
6. Plan approval (hard gate)
7. Implementation
8. Validation (hard gate)
9. Rework loop if needed
10. Ready to complete
11. Final sync preview and approval (hard gate)
12. Atomic sync
13. Completed

### 6.6 Work-Type Specific Nuance

- `feature`: full spec -> plan -> implementation flow
- `refinement`: same flow, but driven by explicit existing feature targets (IDs and/or free-text-derived impact)
- `refactor`: lightweight Work Spec is still mandatory; default assumes no business spec changes unless impact is found or requested

### 6.7 Control Actions Authority

- `force completion` always requires explicit user command
- `cancel workflow` and `sync retry` are user-triggered by default
- AI may auto-trigger `cancel workflow` or `sync retry` only when explicitly authorized by user prompt or project rules

## 7) Validation, Rework, and Approvals

### 7.1 Validation Execution

- AI automatically runs validation checks defined by project rules
- Validation gates are user-defined via project documents/rules

### 7.2 Validation Decisions

- User may mark validation as accepted even if some checks fail
- If checks fail and user wants completion, force completion command is required later
- If completion is triggered with unresolved failed gates and no force completion command, completion is blocked and workflow returns to `rework`

### 7.3 Rework Loop

If user requests changes in validation:

- AI enters `rework`
- AI generates updates (spec and/or plan as needed)
- User hard-gates approvals again where applicable
- AI re-implements and returns to validation

### 7.4 Approval Invalidation Rule

- Approvals are not auto-invalidated
- Re-approval happens only when user explicitly asks

This applies globally, including after drift handling.

## 8) Completion and Atomic Sync

### 8.1 Final Sync Preview

Before sync, AI must produce a final sync preview showing:

- Master docs to be created/updated
- Master feature specs to be created/updated
- Root Master Spec index updates for all affected/created master feature specs
- Decision log entries to be promoted
- History/audit entries to be persisted

One workflow may update/create multiple master feature specs in the same sync.

User must approve this preview before sync runs.

### 8.2 Atomic Semantics

- Sync is all-or-nothing
- If any sync step fails technically, no partial completion is accepted

On sync failure:

- Stay in `ready_to_complete`
- Report failure
- Regenerate preview if needed
- Retry is user-triggered by default

### 8.3 Force Completion

Force completion behavior:

- Must be explicitly commanded by user
- Still requires final sync preview approval
- Preview must include:
  - explicit force-completion command context
  - reason/justification
  - failed gates being overridden
  - risk acceptance (who accepted and when)

### 8.4 Refactor Sync Default

For `refactor`, default sync updates:

- Master Architecture Doc
- Master Implementation Doc
- Master Decision Log
- Change History

Master feature specs are updated only if impact is detected or user requests updates.

### 8.5 Decision Promotion Timing

- Decision List is a per-run artifact
- Promotion to Master Decision Log happens only during final completion/sync

## 9) Branch and Concurrency Model

### 9.1 Workflow ID

- Branch name acts as workflow ID
- Branch name reuse across different runs is allowed
- Historical uniqueness is `(branch_name + timestamp)`

### 9.2 Branch Naming

Default naming:

- `sf/<work-type>/<short-slug>`
- If generated name collides, append autoincrement suffix (`-2`, `-3`, ...)

Branch naming rules can be overridden by:

- User prompt
- Project Constitution
- `AGENTS.md`
- `README.md`

### 9.3 Active Workflow Constraint

- Only one active workflow per branch
- Parallel workflows across different branches are allowed

If user attempts to start on a branch that already has an active workflow:

- Do not auto-create alternatives
- Ignore start attempt
- Show user-facing message

### 9.4 Branch Lifecycle

- Branch is created at intake
- Branches are not auto-deleted on completion or cancellation

## 10) Main-Branch Drift Handling

Drift checks are required:

- Before implementation
- Before completion

If drift is detected:

- Default integration strategy: merge main into workflow branch
- User can override strategy via prompt/project rules
- AI performs impact analysis against current spec/plan/implementation
- User confirms how to proceed based on analysis
- If misalignment is found, workflow returns to `rework`

Conflict handling:

- AI proposes merge conflict resolution
- User approves proposal
- AI applies approved resolution

## 11) Events and Audit Model

### 11.1 Domain Events (MVP)

Core workflow events to record (except where retention policy overrides on cancellation):

- `workflow_started`
- `scope_proposed`
- `scope_confirmed`
- `spec_generated`
- `spec_approved`
- `plan_generated`
- `plan_approved`
- `implementation_started`
- `implementation_completed`
- `validation_accepted`
- `validation_changes_requested`
- `completion_triggered`
- `sync_preview_generated`
- `sync_preview_approved`
- `master_docs_sync_started`
- `master_docs_synced`
- `workflow_completed`
- `workflow_cancelled`
- `drift_detected`
- `main_merge_started`
- `main_merge_completed`
- `merge_conflict_detected`
- `merge_conflict_resolution_proposed`
- `merge_conflict_resolution_approved`
- `merge_conflict_resolution_applied`
- `force_completion_requested`
- `sync_failed`
- `sync_retry_requested`

Removed from MVP:

- Section-lock events (`lock_acquired`, `lock_released`, etc.)

Not required:

- PR-failure-specific audit event

### 11.2 User Prompt/Action Logging

- Store raw prompt/action text with automatic secret masking
- Applies to normal/completed workflow audit trails

### 11.3 Cancellation Minimal Metadata

Cancellation is terminal and keeps minimal metadata only:

- `branch_name`
- `work_type`
- `initiator`
- `created_at`
- `cancelled_at`
- `cancellation_reason`
- `last_state`
- `affected_section_ids`
- `branch_head_sha`
- `branch_exists`

## 12) Per-Run Artifacts and Retention

### 12.1 Working Artifacts During Run

MVP per-run artifacts include:

- Workflow Request context
- Scope map
- Work Spec
- Implementation Plan
- Validation Record
- Decision List
- Completion Report

### 12.2 Versioning and Retention

- Keep latest versions during active run
- Rely on event/audit log for historical trace
- After `workflow_completed`, remove per-run artifacts by default once history is preserved
- User can explicitly request keeping artifacts
- After `workflow_cancelled`, keep only minimal cancellation metadata

## 13) Optional PR Step

- Default: workflow ends before PR creation
- User may explicitly request PR creation
- PR creation failure does not block completion

## 14) Out of Scope for MVP

- Section-level locking across branches/workflows
- Multi-user orchestration beyond branch-level active-workflow constraint
- Human review/approval of pull requests
- Merge-to-main policy enforcement
- Production deployment workflow
- Agent implementation internals (skills/prompts/runtime tooling details)

## 15) Final Source-of-Truth Principle

SpecForge must keep the product source of truth consistent with code by synchronizing:

- Root Master Spec + indexed Master Feature Specs
- Master Architecture Doc
- Master Implementation Doc
- Master Decision Log
- Change History

This synchronization is atomic, user-controlled through hard gates, and fully auditable.
