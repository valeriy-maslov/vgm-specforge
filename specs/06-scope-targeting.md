# Spec: Scope and Targeting

- Feature slug: `scope-targeting`
- Short feature description: Normalize workflow scope before drafting by combining strict references and free-text impact analysis.

## User Stories

### US-ST-01: Confirm scope from strict references

As a software engineer, I want to target exact existing features and sections so updates stay bounded.

Acceptance Criteria:

- Given strict section references in prompt, when intake runs, then AI maps them into an explicit scope map.
- Given refinement/refactor workflow, when strict references are provided, then they are preserved in scope outputs.

### US-ST-02: Confirm scope from free-text requests

As a software engineer, I want AI to infer impacted sections from free text so I can work without memorizing IDs.

Acceptance Criteria:

- Given free-text request, when scope analysis runs, then AI proposes impacted section IDs and affected areas.
- Given proposed scope, when I correct it, then AI updates scope map before drafting starts.

### US-ST-03: Support multi-feature impact

As a software engineer, I want one workflow to target multiple affected features when needed.

Acceptance Criteria:

- Given request impacts multiple feature areas, when scope is confirmed, then scope map includes all affected section IDs.
- Given confirmed scope, when later stages run, then scope IDs remain available for planning, sync, and audit.

## Functional Requirements

- FR-ST-001: SpecForge shall require scope confirmation for all work types before spec drafting begins.
- FR-ST-002: Scope confirmation shall be a soft checkpoint.
- FR-ST-003: Scope analysis shall support strict section-ID references supplied by the user.
- FR-ST-004: Scope analysis shall support free-text requests and generate proposed impacted section IDs.
- FR-ST-005: SpecForge shall present proposed scope for user confirmation or correction.
- FR-ST-006: If user corrects scope, SpecForge shall update the scope map before entering spec drafting.
- FR-ST-007: Scope map shall support multiple impacted areas and multiple master feature specs.
- FR-ST-008: Scope map output shall be available as input to planning, completion/sync preview, and cancellation metadata (`affected_section_ids`).
- FR-ST-009: For refinement and refactor, SpecForge shall support workflows initiated by either strict references or free-text-derived impact analysis.
