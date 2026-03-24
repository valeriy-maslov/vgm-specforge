# SpecForge MVP Test Plan (Human QA)

Status: draft for MVP validation

## 1) Purpose

Validate that SpecForge works end-to-end according to:

- `IMPLEMENTATION_PLAN.md`
- `IMPLEMENTATION_ARCHITECTURE_SPEC.md`
- `ARCHITECTURE.md`
- `SPECFORGE_MVP_EVENT_STORMING.md`
- `specs/index.md`

This is a manual test plan for a human tester (not AI).

## 2) Test Session Record (fill in)

- Tester name:
- Date/time:
- Build/version:
- Commit SHA:
- OS:
- Node.js version:
- npm/pnpm version:
- PostgreSQL version:

## 3) Entry Criteria

- CLI package is buildable and installable.
- Automated checks are green in CI (`lint`, `typecheck`, `test`, `build`).
- Access to a test PostgreSQL instance is available.

## 4) Test Environment Setup

## 4.1 Prerequisites

1. Install Node.js LTS.
2. Install `pnpm` (or use repo standard package manager).
3. Install Git.
4. Start PostgreSQL (local or docker).

## 4.2 Create clean test workspace

```bash
mkdir -p ~/tmp/specforge-manual-test
cd ~/tmp/specforge-manual-test
```

## 4.3 Install SpecForge CLI

Use one method:

- From npm registry (release):

```bash
npm install -g specforge
```

- From local source artifact (pre-release):

```bash
cd <specforge-repo>
npm pack
npm install -g ./specforge-*.tgz
```

Verify install:

```bash
specforge --help
specforge --version
```

Expected:

- command is available in shell
- help prints command groups
- version prints successfully

## 5) Test Cases

Use this status legend:

- PASS = works as expected
- FAIL = requirement not met
- BLOCKED = cannot continue due to prerequisite/problem

For each case, fill:

- Actual result:
- Status (PASS/FAIL/BLOCKED):
- Defect ID(s):

### TC-01: New Project Initialization

Steps:

1. Create a new empty test repo.
2. Run new-project initialization command(s).
3. Review generated initialization bundle and approve it.

Expected:

- initialization completes only after explicit bundled approval
- required artifacts exist (`README.md`, Project Constitution, Root Master Spec, and `AGENTS.md` where applicable)
- `.specforge/` internal structure is created

Actual result:

Status:

Defect ID(s):

### TC-02: Existing Project Initialization + Reconciliation

Steps:

1. Create a small existing repo with code and intentionally mismatched docs.
2. Run existing-project initialization.
3. Confirm reconciliation report is produced.
4. Approve reconciliation and finalize init.

Expected:

- reconciliation report is required when mismatch exists
- init cannot complete until reconciliation approval
- resulting project has Constitution + Root Master Spec and required updates

Actual result:

Status:

Defect ID(s):

### TC-03: Workflow Start and Branch Identity Rules

Steps:

1. Start a workflow from branch `sf/feature/test-flow`.
2. Attempt to start another active workflow on the same branch.
3. Start a workflow on a different branch.

Expected:

- first workflow starts and branch is workflow identity
- second start on same branch is ignored with user-facing message
- parallel workflow on different branch is allowed

Actual result:

Status:

Defect ID(s):

### TC-04: Scope Confirmation (soft checkpoint)

Steps:

1. Start refinement/refactor using free text.
2. Run scope analysis.
3. Correct the proposed scope and confirm.

Expected:

- AI proposes impacted section IDs/areas
- user can correct scope
- flow proceeds after scope confirmation (without hard-gate rule evaluation step)

Actual result:

Status:

Defect ID(s):

### TC-05: Hard Gates for Spec and Plan

Steps:

1. Draft Work Spec.
2. Try to proceed without explicit spec approval.
3. Approve spec and draft plan.
4. Try to implement without explicit plan approval.

Expected:

- cannot pass spec/plan hard gates without explicit approval
- after approval, flow advances correctly
- hard-gate actions record applied rule sources

Actual result:

Status:

Defect ID(s):

### TC-06: Validation and Rework Loop

Steps:

1. Run validation checks.
2. Choose `changes_requested`.
3. Perform rework and re-run validation.

Expected:

- validation checks run automatically per rules
- `changes_requested` moves workflow to `rework`
- flow returns to validation after rework implementation

Actual result:

Status:

Defect ID(s):

### TC-07: Force Completion Path

Steps:

1. Keep at least one validation gate failing.
2. Attempt completion without explicit force command.
3. Run explicit force completion with reason.
4. Review final sync preview and approve.

Expected:

- completion is blocked without explicit force command
- force path requires justification and risk acceptance fields
- final sync still requires explicit preview approval

Actual result:

Status:

Defect ID(s):

### TC-08: Atomic Sync and Retry

Steps:

1. Generate completion sync preview.
2. Simulate sync failure (for example, make target file read-only or inject write failure).
3. Execute sync and observe behavior.
4. Fix failure cause and retry sync.

Expected:

- no partial master-doc updates on failed sync
- workflow remains `ready_to_complete`
- retry works only after explicit user trigger

Actual result:

Status:

Defect ID(s):

### TC-09: Main Drift Detection and Merge

Steps:

1. Create drift by advancing `main` after workflow starts.
2. Run drift check before implementation/completion.
3. Merge `main` into workflow branch.
4. If conflict appears, approve proposed resolution and apply it.

Expected:

- drift is detected at required checkpoints
- default integration strategy is merge-main
- conflict resolution requires proposal + user approval before apply
- misalignment returns workflow to `rework`

Actual result:

Status:

Defect ID(s):

### TC-10: Cancellation and Minimal Retention

Steps:

1. Start a workflow and create in-progress artifacts.
2. Cancel workflow.
3. Query audit/run data for cancelled run.

Expected:

- workflow enters terminal `cancelled`
- run cannot be resumed
- only minimal cancellation metadata is retained for cancelled run

Actual result:

Status:

Defect ID(s):

### TC-11: Audit Query and Secret Masking

Steps:

1. Execute actions containing synthetic secret-like values (test tokens only).
2. Query audit events.

Expected:

- events are queryable by run/type/time
- sensitive-like values are masked before persistence
- no plain secret values in logs/events

Actual result:

Status:

Defect ID(s):

### TC-12: System Asset Update

Steps:

1. Run system update command.
2. Check files under `.specforge/system/`.
3. Verify project docs are not overwritten unexpectedly.

Expected:

- managed assets update via manifest/checksum logic
- only managed system files are modified by update

Actual result:

Status:

Defect ID(s):

### TC-13: CLI JSON Contract

Steps:

1. Run representative commands with `--json`:
   - `workflow status`
   - `scope analyze`
   - `validate run`
   - `complete preview`
   - `audit query`
2. Intentionally trigger one error case.

Expected:

- success responses follow deterministic envelope (`ok: true`, `data`)
- errors follow deterministic envelope (`ok: false`, structured `error`)

Actual result:

Status:

Defect ID(s):

## 6) Exit Criteria

- All critical test cases (`TC-01`..`TC-13`) are PASS.
- No open High severity defects.
- Medium defects have accepted workaround or fix plan.
- Core invariants are confirmed in manual evidence.

## 7) Defect Log (fill in)

| Defect ID | Title | Severity | Test Case | Steps to Reproduce | Expected | Actual | Status | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |

## 8) Cleanup and Reset Instructions

Run after testing to return to a clean state for the next coding phase.

## 8.1 Remove temporary test repositories

```bash
rm -rf ~/tmp/specforge-manual-test
```

## 8.2 Remove globally installed CLI (if installed globally)

```bash
npm uninstall -g specforge
```

If installed from local tarball name:

```bash
npm uninstall -g <tarball-package-name>
```

## 8.3 Reset PostgreSQL test data

Option A (drop and recreate dedicated test database):

```bash
psql -h <host> -U <user> -d postgres -c "DROP DATABASE IF EXISTS specforge_test;"
psql -h <host> -U <user> -d postgres -c "CREATE DATABASE specforge_test;"
```

Option B (drop tables only in shared DB):

```bash
psql -h <host> -U <user> -d <db> -c "DROP TABLE IF EXISTS sf_workflow_events;"
psql -h <host> -U <user> -d <db> -c "DROP TABLE IF EXISTS sf_workflow_runs;"
```

## 8.4 Clean generated branches in test repos

Inside each temporary test repo:

```bash
git checkout master
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/sf/); do git branch -D "$b"; done
```

## 8.5 Verify clean reset

- No temporary test folders remain.
- No `specforge` global install remains (unless intentionally kept).
- PostgreSQL test objects are removed/recreated.
- Ready to rerun this plan from Section 4.

## 9) Final Sign-off (fill in)

- Test result summary:
- Remaining known issues:
- Go/No-Go recommendation:
- Tester signature:
- Date:
