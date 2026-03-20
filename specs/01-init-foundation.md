# Spec: Initialization and Foundation

- Feature slug: `init-foundation`
- Short feature description: Initialize SpecForge for new or existing projects and establish mandatory foundation artifacts before any work workflow starts.

## User Stories

### US-IF-01: Initialize a new project

As a software engineer starting a new codebase, I want SpecForge to bootstrap required project artifacts so I can start spec-driven development with clear governance.

Acceptance Criteria:

- Given a new project context, when I run initialization, then SpecForge creates `README.md`, `AGENTS.md`, Project Constitution, and Root Master Spec.
- Given initialization output, when I request changes, then AI updates artifacts and re-submits the full bundle.
- Given the bundle is approved, when initialization finishes, then project status is marked initialized.

### US-IF-02: Initialize an existing codebase

As a software engineer with an existing repository, I want SpecForge to reconcile actual codebase state with project docs before starting workflows.

Acceptance Criteria:

- Given an existing codebase, when initialization runs, then AI scans code and analyzes current docs plus user instructions.
- Given scan/doc mismatch, when initialization continues, then AI generates a reconciliation report for user approval.
- Given reconciliation is approved, when initialization completes, then Project Constitution and Root Master Spec exist and `AGENTS.md` is created if missing.

### US-IF-03: Prevent premature workflow execution

As a software engineer, I want SpecForge to block normal work workflows until initialization is complete so governance and baseline docs are always present.

Acceptance Criteria:

- Given initialization is not approved, when I try to start feature/refinement/refactor workflow, then SpecForge blocks startup.
- Given initialization is approved, when I start a workflow, then startup is allowed.

## Functional Requirements

- FR-IF-001: SpecForge shall support two initialization entry modes: new project and existing codebase.
- FR-IF-002: For new project mode, SpecForge shall generate `README.md`, `AGENTS.md`, Project Constitution, and Root Master Spec.
- FR-IF-003: For existing codebase mode, SpecForge shall scan repository content and incorporate explicit user instructions.
- FR-IF-004: For existing codebase mode, SpecForge shall generate `AGENTS.md` only if it does not already exist.
- FR-IF-005: For existing codebase mode, when scan results conflict with documentation, SpecForge shall generate a baseline reconciliation report.
- FR-IF-006: Initialization completion for existing codebase mode shall require explicit user approval of reconciliation report when produced.
- FR-IF-007: Initialization approval shall be a single bundled approval over initialization artifacts.
- FR-IF-008: If user requests initialization changes, SpecForge shall iterate in a revise-and-resubmit loop until bundled approval is granted.
- FR-IF-009: SpecForge shall mark initialization as complete only after bundled approval is granted.
- FR-IF-010: SpecForge shall block all feature/refinement/refactor workflow starts until initialization is complete.
- FR-IF-011: SpecForge shall persist initialization outcome metadata including mode, approval timestamp, and generated artifact list.
