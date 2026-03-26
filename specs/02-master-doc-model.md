# Spec: Master Documentation Model

- Feature slug: `master-doc-model`
- Short feature description: Define the canonical master documentation structure and section identity rules that keep product docs synchronized with code.

## User Stories

### US-DM-01: Maintain a single product source of truth

As a software engineer, I want root and feature-level master specs to represent current product behavior so documentation stays trustworthy.

Acceptance Criteria:

- Given Root Master Spec exists, when I inspect it, then it contains product-level information and an index to master feature specs.
- Given multiple features evolve, when sync runs, then one or many master feature specs may be created or updated.

### US-DM-02: Use stable section references

As a software engineer, I want stable section IDs so AI can target exact sections for impact analysis and updates.

Acceptance Criteria:

- Given any master document section, when referenced by workflows, then it has a stable section ID that is unique within that document.
- Given missing IDs during initialization, when initialization completes, then missing IDs are auto-generated.

### US-DM-03: Bootstrap missing master docs on first sync

As a software engineer, I want SpecForge to create missing master docs automatically during first completion/sync so setup remains lightweight.

Acceptance Criteria:

- Given only Root Master Spec exists, when first completion/sync executes, then missing master docs are created and updated in the same atomic operation.
- Given sync preview is generated, when I review it, then all create/update operations are listed.

## Functional Requirements

- FR-DM-001: SpecForge shall treat the Root Master Spec as the umbrella product document.
- FR-DM-002: Root Master Spec shall include an index of master feature specs.
- FR-DM-003: SpecForge shall support master feature specs as multiple separate files.
- FR-DM-004: Canonical master docs shall include Root Master Spec, Master Feature Specs, Master Architecture Doc, Master Implementation Doc, Master Decision Log, and Change History.
- FR-DM-005: Stable section IDs shall be required for master docs, with uniqueness guaranteed per document.
- FR-DM-006: During initialization, SpecForge shall auto-generate missing section IDs in master docs.
- FR-DM-007: Initialization shall require only Root Master Spec as mandatory master artifact.
- FR-DM-008: Other canonical master docs shall be created when first required during completion/sync.
- FR-DM-009: Completion/sync shall support updating or creating multiple master feature specs in a single workflow.
- FR-DM-010: Completion/sync shall update Root Master Spec index entries for all affected or newly created master feature specs.
