# SpecForge MVP Release Notes (0.1.0)

Date: 2026-03-26

## Highlights

- Delivered a workspace-packable TypeScript CLI (`specforge`) with tarball install smoke validation aligned to the MVP architecture and specs.
- Implemented full workflow orchestration from initialization through completion, including hard-gate approvals and rework loops.
- Added automated main-branch drift checkpoints at both pre-implementation and pre-completion gates.
- Added optional PR-request path in completion flow without making PR creation a hard blocker.
- Implemented local markdown master-doc storage and atomic sync semantics.

## Scope Delivered (Specs)

- `specs/01-init-foundation.md`: init for new/existing repos, artifact bootstrap, reconciliation findings/report.
- `specs/02-master-doc-model.md`: canonical master-doc model and section ID backfill support.
- `specs/03-branch-workflow-identity.md`: one active workflow per branch, run identity `(branch + started_at)`.
- `specs/04-workflow-state-machine.md`: canonical workflow state machine transitions.
- `specs/05-rule-resolution-hard-gates.md`: rule precedence and hard-gate enforcement.
- `specs/06-scope-targeting.md`: scope analyze/confirm checkpoints.
- `specs/07-spec-plan-authoring.md`: spec/plan draft and approval loops.
- `specs/08-validation-rework.md`: validation decision and rework path.
- `specs/09-completion-sync-force.md`: preview/approve/sync plus force-completion safeguards.
- `specs/10-main-drift-management.md`: drift detect/integrate/resolve, conflict proposal, confirmation gates.
- `specs/11-audit-retention.md`: append/query audit events and run retention semantics.
- `specs/12-optional-pr-integration.md`: completion `--request-pr` behavior and output semantics.

## Event Model Coverage

MVP runtime emits and persists the domain event stream defined in `packages/contracts/src/events.ts`, including:

- Lifecycle events (`workflow_started`, `implementation_completed`, `workflow_completed`, `workflow_cancelled`).
- Hard-gate and sync events (`completion_triggered`, `sync_preview_generated`, `master_docs_synced`, `sync_failed`, `sync_retry_requested`).
- Drift and conflict events (`drift_detected`, `main_merge_started`, `main_merge_completed`, `merge_conflict_detected`, `merge_conflict_resolution_proposed`, `merge_conflict_resolution_applied`).
- Force path events (`force_completion_requested`).

## Quality and Verification

Final release-readiness gate run completed successfully:

- `pnpm -r lint`
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm --filter @specforge/cli test:e2e`
- `pnpm -r build`

Packaging smoke test completed with packed workspace tarballs and clean install in a temp project; CLI boot verified with `specforge --help`.

## Known Limitations (MVP)

- Drift impact analysis is intentionally heuristic for MVP and may require operator confirmation for ambiguous cases.
- Packaging currently depends on workspace package tarball installation for local smoke tests.
- Optional PR integration does not block completion sync on PR failures.
