# Spec: Optional Pull Request Integration

- Feature slug: `optional-pr-integration`
- Short feature description: Keep PR creation outside the default workflow while supporting explicit user-requested PR creation.

## User Stories

### US-PR-01: Complete workflow without PR by default

As a software engineer, I want default workflow completion to end before PR so SpecForge remains focused on spec-to-implementation synchronization.

Acceptance Criteria:

- Given normal workflow completion, when sync succeeds, then workflow is completed without requiring PR creation.

### US-PR-02: Request PR creation when needed

As a software engineer, I want to request PR creation on demand so I can include repository collaboration steps when useful.

Acceptance Criteria:

- Given explicit user request, when workflow reaches appropriate stage, then SpecForge attempts PR creation.
- Given no explicit request, when workflow completes, then no PR operation runs.

### US-PR-03: Do not block completion on PR failures

As a software engineer, I want workflow completion to remain independent from PR tooling failures.

Acceptance Criteria:

- Given PR creation is requested and fails, when workflow completion is evaluated, then completion is not blocked.
- Given PR creation failure, when result is shown, then user receives visible failure feedback.

## Functional Requirements

- FR-PR-001: Default MVP workflow shall end before PR creation.
- FR-PR-002: SpecForge shall support PR creation only on explicit user request.
- FR-PR-003: PR creation request shall be treated as optional extension step and not as mandatory completion criterion.
- FR-PR-004: If requested PR creation fails, SpecForge shall not block `workflow_completed` state.
- FR-PR-005: If requested PR creation fails, SpecForge shall present failure message to user.

## MVP CLI Contract Notes

- PR creation is requested only through completion sync:
  - `specforge complete sync --request-pr`
  - Optional fields: `--pr-title`, `--pr-body` (valid only when `--request-pr` is present)
- If PR creation is requested and succeeds, completion output includes:
  - `pullRequest.requested: true`
  - `pullRequest.created: true`
  - `pullRequest.url`
- If PR creation is requested and fails, completion still proceeds and output includes:
  - `pullRequest.requested: true`
  - `pullRequest.created: false`
  - failure message in `pullRequest.message` and/or `result.message`
