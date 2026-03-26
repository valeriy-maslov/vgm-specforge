# SpecForge MVP Implementation Plan

Status: in-progress (M6 release readiness; final reviewer closure pending)

This plan is implementation-ready and optimized for parallel AI-assisted delivery.

References:

- `ARCHITECTURE.md`
- `IMPLEMENTATION_ARCHITECTURE_SPEC.md`
- `SPECFORGE_MVP_EVENT_STORMING.md`
- `specs/index.md`

## 1) Delivery Goals

- Build a TypeScript Node.js CLI (`specforge`) with workspace packaging validated via tarball install smoke tests and a clear npm-release path.
- Implement the MVP workflow engine and hard-gate model.
- Ship PostgreSQL audit logging via driver interface.
- Ship local markdown master-doc storage with atomic sync semantics.
- Keep extension points open for future drivers/plugins.

## 2) Execution Style (AI Vibe Coding)

- Work in small vertical slices with clear acceptance checks.
- Assign independent tasks to multiple coding subagents in parallel.
- Keep domain pure and adapter boundaries strict.
- Require review-only subagents before accepting each milestone.
- Prefer deterministic command outputs (`--json`) for agent coordination.

## 3) Global Constraints and Invariants

- One active workflow per branch.
- Workflow run identity is `(branch_name + started_at)`.
- Hard gates require explicit approval by default.
- Rule precedence model is `prompt > constitution > AGENTS.md > README.md` across loaded rule sources.
- Sync is atomic all-or-nothing.
- Force completion requires explicit command and justification.
- Cancellation is terminal with minimal metadata retention.

## 4) Milestones and Dependency Graph

Dependency graph:

```text
M0 Foundation
  -> M1 Contracts + Domain
    -> M2 Application Services
      -> M3 Adapters (Git, Docs, Audit, Assets) [parallel]
        -> M4 CLI Commands + Composition
          -> M5 End-to-End Scenarios + Hardening
            -> M6 Release Readiness
```

Milestone exit criteria:

- M0: workspace builds, lint/typecheck/test scaffolding works.
- M1: state machine and policies covered by unit tests.
- M2: service orchestration implemented with mocked ports.
- M3: adapters pass integration tests.
- M4: all MVP CLI commands available with human and JSON output.
- M5: full workflow scenarios pass E2E tests.
- M6: docs and release checklist complete.

## 5) Parallel Subagent Lanes

- C1 Core Contracts: `@specforge/contracts`
- C2 Domain Engine: `@specforge/domain`
- C3 Application Workflow: `@specforge/application` (workflow/scope/spec/plan/validate)
- C4 Application Completion: `@specforge/application` (completion/drift/audit/init)
- C5 Git + Docs Adapters: `@specforge/adapters-git`, `@specforge/adapters-docs-local-md`
- C6 PostgreSQL Adapter: `@specforge/adapters-audit-postgres`
- C7 Assets + CLI Core: `@specforge/adapters-system-assets`, `@specforge/cli` base
- C8 CLI Commands + E2E: `@specforge/cli` command groups + scenario tests

Run lanes in parallel when dependency preconditions are met.

## 6) Detailed Task Backlog

## M0 - Workspace Foundation

| Task ID | Package/Area | Task | Depends on | Lane | Done when |
| --- | --- | --- | --- | --- | --- |
| M0-T01 | root | Create workspace files (`package.json`, workspace, tsconfig base) | none | C1 | workspace boots with `pnpm install` |
| M0-T02 | root | Configure lint, format, test scripts at root | M0-T01 | C7 | `pnpm lint` and `pnpm test` run |
| M0-T03 | packages/* | Create package skeletons from architecture blueprint | M0-T01 | C1 | all package dirs compile |
| M0-T04 | root CI | Add CI pipeline for lint/typecheck/test/build | M0-T02 | C7 | CI config validates locally |
| M0-T05 | root docs | Add contributor execution notes for plan usage | M0-T01 | C7 | docs reference plan and architecture |

## M1 - Contracts and Domain

| Task ID | Package/Area | Task | Depends on | Lane | Done when |
| --- | --- | --- | --- | --- | --- |
| M1-T01 | contracts | Define core types: work type, state, run key, actor, errors | M0-T03 | C1 | types exported and documented |
| M1-T02 | contracts | Define event envelopes and event names | M1-T01 | C1 | event catalog compiles |
| M1-T03 | contracts | Define ports: `AuditDriver`, `MasterDocStore`, `GitPort` | M1-T01 | C1 | interfaces compile |
| M1-T04 | contracts | Define command/result DTOs for CLI services | M1-T01 | C1 | DTO package complete |
| M1-T05 | domain | Implement state model and transition map | M1-T01 | C2 | transitions for all canonical states |
| M1-T06 | domain | Implement hard-gate policy and guard checks | M1-T05 | C2 | gate checks pass unit tests |
| M1-T07 | domain | Implement rule precedence resolver | M1-T01 | C2 | precedence tests pass |
| M1-T08 | domain | Implement force-completion policy | M1-T06 | C2 | override rules validated |
| M1-T09 | domain | Implement retention policy (completed/cancelled) | M1-T05 | C2 | retention tests pass |
| M1-T10 | domain | Implement branch identity and concurrency rules | M1-T05 | C2 | one-active-workflow tests pass |
| M1-T11 | domain | Unit tests: transitions, guards, invariants | M1-T05..M1-T10 | C2 | domain coverage target reached |

## M2 - Application Services

| Task ID | Package/Area | Task | Depends on | Lane | Done when |
| --- | --- | --- | --- | --- | --- |
| M2-T01 | application | Build command context and orchestration utilities | M1-T03 | C3 | context used by all services |
| M2-T02 | application | Implement rule evaluation at hard gates | M1-T07, M2-T01 | C4 | gate rule logs produced |
| M2-T03 | application | `InitService` (new/existing + reconciliation + bundled approval) | M1-T05, M2-T01 | C4 | init flows pass service tests |
| M2-T04 | application | `WorkflowService` (start/status/cancel) | M1-T10, M2-T01 | C3 | run lifecycle updates pass |
| M2-T05 | application | `ScopeService` (analyze/confirm) | M1-T05, M2-T01 | C3 | scope soft checkpoint handled |
| M2-T06 | application | `SpecService` and `PlanService` loops | M1-T06, M2-T01 | C3 | draft/approve loops tested |
| M2-T07 | application | `ValidationService` (`run`, `decide`) | M1-T06, M2-T01 | C3 | rework transitions tested |
| M2-T08 | application | `CompletionService` (preview/approve/sync/force) | M1-T08, M2-T02 | C4 | force and sync paths tested |
| M2-T09 | application | `DriftService` (check/merge/resolve) | M1-T05, M2-T01 | C4 | drift decisions tested |
| M2-T10 | application | `AuditService` query APIs | M1-T02, M2-T01 | C4 | event query service tested |
| M2-T11 | application | Service-level tests with mocked ports | M2-T03..M2-T10 | C3/C4 | all service tests pass |

## M3 - Adapters (Parallel)

| Task ID | Package/Area | Task | Depends on | Lane | Done when |
| --- | --- | --- | --- | --- | --- |
| M3-T01 | adapters-git | Implement git command wrapper and error mapping | M2-T01 | C5 | adapter API responds deterministically |
| M3-T02 | adapters-git | Branch ops: exists/create/current/head | M3-T01 | C5 | branch tests pass |
| M3-T03 | adapters-git | Drift ops: detect and merge main | M3-T01 | C5 | drift integration tests pass |
| M3-T04 | adapters-git | Conflict detection and apply flow hooks | M3-T03 | C5 | conflict fixtures pass |
| M3-T05 | adapters-docs-local-md | Markdown doc read/write abstraction | M2-T01 | C5 | doc IO adapter tests pass |
| M3-T06 | adapters-docs-local-md | Stable section ID parser/generator/backfill | M3-T05 | C5 | ID generation tests pass |
| M3-T07 | adapters-docs-local-md | Sync planner output model | M3-T05 | C5 | preview deterministic output |
| M3-T08 | adapters-docs-local-md | Atomic file writer for sync apply | M3-T05 | C5 | no partial-write tests pass |
| M3-T09 | adapters-audit-postgres | Create migrations and schema indexes | M2-T01 | C6 | migration up/down passes |
| M3-T10 | adapters-audit-postgres | Implement `AuditDriver` methods | M3-T09 | C6 | append/query/getRun/saveRun pass |
| M3-T11 | adapters-audit-postgres | Secret masking at persistence boundary | M3-T10 | C6 | masking tests pass |
| M3-T12 | adapters-system-assets | Manifest + checksum model | M2-T01 | C7 | manifest validation passes |
| M3-T13 | adapters-system-assets | `system update` updater engine | M3-T12 | C7 | updates only managed files |
| M3-T14 | adapters-system-assets | Prompt/skill asset layout management | M3-T12 | C7 | managed asset tests pass |
| M3-T15 | adapters-* | Adapter integration tests (git, docs, pg, assets) | M3-T04, M3-T08, M3-T11, M3-T14 | C5/C6/C7 | integration suite green |

## M4 - CLI and Composition

| Task ID | Package/Area | Task | Depends on | Lane | Done when |
| --- | --- | --- | --- | --- | --- |
| M4-T01 | cli | CLI bootstrap (`bin/specforge.ts`) and command registration | M2-T11 | C7 | `specforge --help` works |
| M4-T02 | cli | Human and JSON output envelope helpers | M4-T01 | C7 | uniform output for all handlers |
| M4-T03 | cli | `init`, `system`, `config` command handlers | M4-T01, M3-T14 | C8 | command tests pass |
| M4-T04 | cli | `workflow`, `scope` command handlers | M4-T01, M2-T05 | C8 | command tests pass |
| M4-T05 | cli | `spec`, `plan`, `validate` command handlers | M4-T01, M2-T07 | C8 | command tests pass |
| M4-T06 | cli | `complete`, `drift`, `audit` handlers | M4-T01, M2-T10 | C8 | command tests pass |
| M4-T07 | cli | Composition container wiring ports/services | M4-T01, M3-T15 | C7 | all commands resolve dependencies |
| M4-T08 | cli | Plugin loader wiring for drivers/doc stores | M4-T07 | C7 | plugin resolution tests pass |
| M4-T09 | cli | Command contract tests (`--json`) | M4-T03..M4-T08 | C8 | deterministic JSON snapshots pass |

## M5 - End-to-End and Hardening

| Task ID | Package/Area | Task | Depends on | Lane | Done when |
| --- | --- | --- | --- | --- | --- |
| M5-T01 | e2e | Build repo fixture and test harness | M4-T09 | C8 | harness stable in CI |
| M5-T02 | e2e | Scenario: init new project | M5-T01 | C8 | scenario green |
| M5-T03 | e2e | Scenario: init existing + reconciliation | M5-T01 | C8 | scenario green |
| M5-T04 | e2e | Scenario: feature happy path | M5-T01 | C8 | scenario green |
| M5-T05 | e2e | Scenario: refinement flow | M5-T01 | C8 | scenario green |
| M5-T06 | e2e | Scenario: refactor flow | M5-T01 | C8 | scenario green |
| M5-T07 | e2e | Scenario: validation rework loop | M5-T01 | C8 | scenario green |
| M5-T08 | e2e | Scenario: force completion path | M5-T01 | C8 | scenario green |
| M5-T09 | e2e | Scenario: cancelled run minimal retention | M5-T01 | C8 | retention assertions pass |
| M5-T10 | e2e | Scenario: drift detect + merge + conflict resolution approval | M5-T01 | C8 | scenario green |
| M5-T11 | e2e | Scenario: one-active-workflow-per-branch | M5-T01 | C8 | start attempt ignored + message shown |
| M5-T12 | e2e | Scenario: optional PR request path behavior | M5-T01 | C8 | completion not blocked by PR failure |
| M5-T13 | quality | Performance, error-path, and retry hardening | M5-T02..M5-T12 | C7/C8 | no blocker defects |

## M6 - Release Readiness

| Task ID | Package/Area | Task | Depends on | Lane | Done when |
| --- | --- | --- | --- | --- | --- |
| M6-T01 | docs | Update architecture/spec docs if implementation deviates | M5-T13 | C7 | docs and behavior aligned |
| M6-T02 | package | npm packaging smoke test (`npm pack`, install in temp repo) | M5-T13 | C7 | install and CLI run succeed |
| M6-T03 | quality | Final full test gate + coverage threshold | M6-T01, M6-T02 | C8 | all gates green |
| M6-T04 | release | Prepare release notes from specs and event history | M6-T03 | C7 | release notes ready |

## 7) Suggested Parallel Execution Waves

Wave A (start together):

- C1: M0-T01..M0-T03, M1-T01..M1-T04
- C2: M1-T05..M1-T11 (after M1-T01)
- C7: M0-T02, M0-T04..M0-T05

Wave B (after M1 done):

- C3: M2-T01, M2-T04..M2-T07, M2-T11
- C4: M2-T02..M2-T03, M2-T08..M2-T10

Wave C (after M2 foundations):

- C5: M3-T01..M3-T08
- C6: M3-T09..M3-T11
- C7: M3-T12..M3-T14

Wave D (after core adapters ready):

- C7: M4-T01..M4-T02, M4-T07..M4-T08
- C8: M4-T03..M4-T06, M4-T09

Wave E (after CLI ready):

- C8: M5-T01..M5-T12
- C7/C8: M5-T13, M6-T01..M6-T04

## 8) Coding Subagent Prompt Pack (Reusable Statements)

Use these as copy/paste statements in your subagent orchestration tool.

### Statement C-Core

You are Coding Subagent C-Core.
Implement tasks: `M1-T01` to `M1-T11`.
Scope: `packages/contracts`, `packages/domain`.
Rules:

- Keep domain pure (no IO).
- Follow invariants from `IMPLEMENTATION_ARCHITECTURE_SPEC.md`.
- Add unit tests for transitions, hard gates, precedence, and force completion.

Return format:

- changed files
- test commands run
- known risks/questions

### Statement C-App

You are Coding Subagent C-App.
Implement tasks: `M2-T01` to `M2-T11`.
Scope: `packages/application`.
Rules:

- Use ports only; no direct adapter coupling.
- Evaluate and log rules only at hard gates.
- Keep service methods deterministic and typed.

Return format:

- changed files
- tests added
- open integration hooks

### Statement C-Adapters

You are Coding Subagent C-Adapters.
Implement tasks: `M3-T01` to `M3-T15`.
Scope: `packages/adapters-*`.
Rules:

- Implement PostgreSQL driver + local markdown doc store + atomic writer.
- Mask secrets before audit persistence.
- Validate no partial writes in sync failures.

Return format:

- changed files
- migrations and tests
- reliability concerns

### Statement C-CLI

You are Coding Subagent C-CLI.
Implement tasks: `M4-T01` to `M4-T09`, `M5-T01` to `M5-T13`.
Scope: `packages/cli` plus E2E harness.
Rules:

- Every command supports human and `--json` output.
- Command handlers call application services only.
- Cover full scenarios from specs.

Return format:

- changed files
- contract/e2e test results
- any UX/API gaps

## 9) Review-Only Subagent Statements (Non-Coding)

Run these after each milestone and before merges. These subagents must not edit code.

### Statement R1 - Architecture Conformance Review

You are Review Subagent R1 (non-coding).
Review current branch for architecture conformance.
Check:

1. Dependency direction matches `IMPLEMENTATION_ARCHITECTURE_SPEC.md`.
2. Domain has no IO and no adapter imports.
3. Service orchestration uses ports/contracts.

Return:

- verdict: PASS or FAIL
- blocking issues with file paths
- non-blocking improvements

### Statement R2 - Requirements and Invariants Review

You are Review Subagent R2 (non-coding).
Validate implementation against `specs/index.md` and `SPECFORGE_MVP_EVENT_STORMING.md`.
Check:

1. Hard gates, precedence, and workflow state model.
2. Force completion and cancellation semantics.
3. Branch identity and one-active-workflow constraints.

Return:

- traceability matrix: requirement -> evidence file
- missing/partial items
- verdict

### Statement R3 - Security and Logging Review

You are Review Subagent R3 (non-coding).
Audit security-sensitive paths.
Check:

1. Secret masking before audit persistence.
2. No plain secrets in logs/errors/events.
3. Safe file writes and conflict/error handling.

Return:

- findings by severity (high/medium/low)
- remediation recommendations
- verdict

### Statement R4 - Test Quality Review

You are Review Subagent R4 (non-coding).
Review test suite quality and requirement coverage.
Check:

1. Unit tests for domain policies.
2. Integration tests for adapters.
3. E2E scenarios for all MVP flow variants.

Run and summarize:

- `pnpm -r lint`
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm -r build`

Return:

- pass/fail per command
- missing test scenarios
- flaky-risk notes
- verdict

### Statement R5 - CLI Contract Review

You are Review Subagent R5 (non-coding).
Validate CLI command surface and output determinism.
Check:

1. Commands match architecture matrix.
2. `--json` envelope is consistent and machine-readable.
3. Error codes/messages are structured and actionable.

Return:

- command-by-command compliance table
- contract breaks
- verdict

### Statement R6 - Documentation Alignment Review

You are Review Subagent R6 (non-coding).
Validate docs and implementation alignment.
Check:

1. `ARCHITECTURE.md`, `IMPLEMENTATION_ARCHITECTURE_SPEC.md`, `IMPLEMENTATION_PLAN.md` reflect current code.
2. Spec docs in `specs/` map to implemented features.
3. Developer instructions remain accurate.

Return:

- docs mismatch list
- required updates
- verdict

## 10) Review Gate Schedule

- After M1: run R1, R2
- After M3: run R1, R3
- After M4: run R1, R5
- After M5: run R2, R4, R5
- Before release (M6): run R1, R2, R3, R4, R5, R6

No milestone is accepted until all scheduled reviewers return PASS or approved exceptions.

## 11) Standard Verification Commands

Core gate commands:

- `pnpm install`
- `pnpm -r lint`
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm -r build`

Adapter-focused commands:

- `pnpm --filter @specforge/adapters-audit-postgres test`
- `pnpm --filter @specforge/adapters-docs-local-md test`
- `pnpm --filter @specforge/adapters-git test`

CLI and E2E:

- `pnpm --filter @specforge/cli test`
- `pnpm --filter @specforge/cli test:e2e`

## 12) Definition of Done

- All tasks in milestone are complete.
- Scheduled review subagents returned PASS.
- Required tests and quality gates passed.
- Specs and architecture docs updated where behavior changed.
- No invariant violations.
- Release artifacts install and run in clean environment.
