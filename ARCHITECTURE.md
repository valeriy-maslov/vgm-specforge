# SpecForge Architecture (MVP)

## 1. Purpose

This document defines the high-level architecture for SpecForge MVP.

SpecForge is a Node.js CLI framework for spec-driven development with AI coding agents. It orchestrates workflows from initialization through spec, plan, implementation, validation, and completion sync, while preserving auditable history.

Supported agents for MVP:

- OpenCode
- Codex
- Claude Code

## 2. Architectural Drivers

- Installable with `npm` as a Node.js application.
- Operates as a CLI control plane for users and AI-agent-invoked commands.
- Enforces workflow rules from project files with precedence:
  - user prompt > Project Constitution > `AGENTS.md` > `README.md`
- Maintains source-of-truth master documentation synchronized with code.
- Persists auditable history through a pluggable audit-log driver.
- Supports extension points for external document backends (future), with local markdown as MVP default.
- Follows hard-gated user control model for key approvals.

## 3. System Context

```text
Software Engineer
   |
   | uses
   v
specforge CLI <----------------------------- AI coding agents (via skills/prompts)
   |
   | command handlers
   v
Application Services
   |
   v
Domain Core (workflow, policies, rules, events)
   |
   +-- Git adapter
   +-- Audit adapter (driver SPI; PostgreSQL in MVP)
   +-- Master-doc store adapter (plugin SPI; local markdown in MVP)
   +-- Managed system-assets updater
```

## 4. Architectural Style

SpecForge uses a layered hexagonal architecture.

- Domain Core (pure business rules)
- Application Layer (workflow orchestration and use cases)
- Interface Adapters (CLI, Git, storage, plugins)
- Infrastructure (PostgreSQL driver, filesystem doc store)

Benefits:

- Core workflow logic remains independent from CLI details and storage choices.
- New audit drivers and doc-store plugins can be added without changing core workflow rules.

## 5. Main Runtime Components

### 5.1 CLI Layer

Responsibilities:

- Parse commands and options.
- Provide human-friendly text output.
- Provide machine-friendly `--json` output for agent tooling.
- Validate user intent and pass normalized requests to application services.

### 5.2 Application Services

Responsibilities:

- Execute use cases (`init`, `workflow start`, `spec approve`, `complete sync`, etc.).
- Coordinate domain rules, Git operations, audit writes, and document updates.
- Emit domain events for each meaningful transition.

### 5.3 Domain Core

Responsibilities:

- Unified workflow state model (`feature`, `refinement`, `refactor`).
- Hard-gate policy enforcement.
- Rule-source precedence resolution at hard gates.
- Force-completion policy and validation gate behavior.
- Branch/workflow identity rules.
- Drift and rework decision logic.

### 5.4 Infrastructure Adapters

- Git adapter: branch lifecycle, drift checks, merge operations.
- Audit adapter: append/query workflow events through driver contract.
- Master-doc adapter: preview and apply synchronized document changes.
- Managed-assets updater: update non-editable SpecForge system files.

## 6. Packaging and Installation

- Distributed as an npm package exposing `specforge` executable.
- Runtime: Node.js LTS.
- Configurable via project-level config file and CLI commands.

Recommended package structure:

```text
packages/
  cli/
  core/
  app/
  adapters/
    git/
    audit-postgres/
    docs-local-md/
  plugins/
    interfaces/
```

## 7. Project Files and Managed Assets

### 7.1 User/Project Artifacts

- `README.md`
- `AGENTS.md`
- Project Constitution
- Root Master Spec
- Master Feature Specs
- Master Architecture Doc
- Master Implementation Doc
- Master Decision Log
- Change History

### 7.2 SpecForge Internal Files

```text
.specforge/
  config.yaml
  system/        # non-editable managed assets: prompts, skills, manifests
  state/         # runtime metadata/checkpoints
```

`specforge system update` updates files in `.specforge/system/` using versioned manifests and checksums.

## 8. AI Agent Integration Model

- User opens preferred coding agent (OpenCode, Codex, Claude Code) after initialization.
- Agent receives SpecForge-provided skills/prompts (managed assets).
- Skills/prompts may instruct agent to call predefined `specforge` CLI commands.
- CLI is the only execution entrypoint for state-changing framework actions.

This keeps deterministic workflow behavior regardless of which coding agent is used.

## 9. Workflow and State Architecture

Canonical states:

- `intake`
- `scope_confirmed` (soft checkpoint)
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

Hard gates (exact):

1. Initialization bundled approval
2. Spec approval
3. Plan approval
4. Validation decision
5. Final sync preview approval

Control model:

- AI must not auto-advance hard gates by default.
- User prompt may explicitly override behavior.

## 10. Rule Resolution Architecture

Rule resolution occurs at hard gates only.

Inputs:

- User instruction/prompt context
- Project Constitution
- `AGENTS.md`
- `README.md`

Resolver responsibilities:

- Merge rules using precedence model.
- Produce effective rule set for current gate.
- Persist "applied rules + source" audit entry.

## 11. Master Document Sync Architecture

Two-step completion model:

1. Generate sync preview.
2. Apply atomic sync after user approval.

Sync preview includes:

- Docs to create/update.
- Root Master Spec index updates.
- Decision promotions.
- History entries to persist.

Atomicity requirement:

- All-or-nothing update.
- On failure, remain in `ready_to_complete`; user may trigger retry.

## 12. Drift Handling Architecture

Drift checks occur:

- Before implementation.
- Before completion.

Default strategy:

- Merge `main` into workflow branch.

If merge conflict occurs:

1. AI proposes conflict resolution.
2. User approves proposal.
3. AI applies resolution.

If post-merge misalignment is detected, transition to `rework`.

## 13. Plugin and Driver Architecture

### 13.1 Audit Driver SPI

```ts
export interface AuditDriver {
  connect(config: unknown): Promise<void>;
  append(event: AuditEvent): Promise<void>;
  query(filter: AuditQuery): Promise<AuditEvent[]>;
  close(): Promise<void>;
}
```

MVP driver:

- PostgreSQL-based audit driver.

### 13.2 Master Document Store SPI

```ts
export interface MasterDocStore {
  load(ref: DocRef): Promise<Doc>;
  planSync(changeSet: SyncChangeSet): Promise<SyncPreview>;
  applySync(changeSet: SyncChangeSet): Promise<SyncResult>; // atomic
}
```

MVP implementation:

- Local markdown file store in repository.

Future plugins:

- Confluence
- Project wiki backends
- Other external document systems

## 14. PostgreSQL Audit Driver (MVP)

Suggested tables:

- `sf_workflow_runs`
  - identifies run by `(branch_name, started_at)`
  - stores work type, current state, actor metadata, lifecycle timestamps
- `sf_workflow_events`
  - append-only event stream with JSON payload
  - indexed by branch/run, type, and timestamp

Data handling rules:

- Mask secrets before persisting prompt/action logs.
- Keep cancellation retention minimal as defined by product specs.
- Remove per-run artifacts after completion by default once history is preserved.

## 15. CLI Command Surface (MVP)

Representative command groups:

- `specforge init`
- `specforge system update`
- `specforge config get|set`
- `specforge workflow start|status|cancel`
- `specforge scope analyze|confirm`
- `specforge spec draft|approve`
- `specforge plan draft|approve`
- `specforge validate run|decide`
- `specforge complete preview|approve|sync|force`
- `specforge drift check|merge-main|resolve`
- `specforge audit query`

All state-changing actions must pass through CLI commands so agents and humans operate the same workflow engine.

## 16. Security and Safety Considerations

- Secret masking before audit persistence.
- Explicit user approval for hard gates.
- Explicit user command required for force completion.
- Prevent concurrent active workflows on same branch.
- No destructive branch cleanup by default.

## 17. Extensibility and Evolution

MVP delivers:

- CLI + workflow core
- PostgreSQL audit driver
- Local markdown master-doc store

Planned extension points:

- Additional audit drivers via `AuditDriver` SPI
- External master-doc providers via `MasterDocStore` SPI
- Additional agent packs (skills/prompts) through managed system assets

## 18. Traceability to MVP Specs

This architecture implements the feature specs in `specs/index.md` and aligns with the event-storming baseline in `SPECFORGE_MVP_EVENT_STORMING.md`.
