# Spec: Rule Resolution and Hard Gates

- Feature slug: `rule-resolution-hard-gates`
- Short feature description: Enforce deterministic governance using rule-source precedence and explicit user-controlled hard-gate approvals.

## User Stories

### US-RG-01: Resolve conflicting instructions predictably

As a software engineer, I want deterministic rule precedence so AI behavior is controllable and auditable.

Acceptance Criteria:

- Given conflicting rules across prompt and any loaded lower-precedence sources (Constitution, `AGENTS.md`, `README.md`), when a hard gate is evaluated, then higher-precedence rule wins.
- Given a hard gate decision, when recorded, then applied rule sources are logged.

### US-RG-02: Keep hard-gate approvals under user control

As a software engineer, I want explicit approvals at key checkpoints so AI does not auto-advance critical decisions.

Acceptance Criteria:

- Given workflow at hard gate, when user has not approved, then SpecForge does not advance by default.
- Given explicit user request to alter behavior, when authorized by prompt/rules, then alternate gate behavior may be applied.

### US-RG-03: Control critical workflow actions

As a software engineer, I want strict control over completion overrides and retries.

Acceptance Criteria:

- Given force completion, when requested, then it requires explicit user command.
- Given cancel or sync retry, when not otherwise authorized, then those actions are user-triggered by default.

## Functional Requirements

- FR-RG-001: Rule precedence model shall be `user prompt > Project Constitution > AGENTS.md > README.md` across loaded sources.
- FR-RG-002: Rule resolution shall execute at hard gates and any rule-aware checkpoint automation that can block or redirect workflow progression (for MVP: pre-implementation and pre-completion drift checkpoints).
- FR-RG-003: SpecForge shall log which sources and rules were applied at each hard gate where rule evaluation runs; initialization bundled approval is recorded via initialization state metadata.
- FR-RG-004: Hard gates shall be exactly: initialization bundled approval, spec approval, plan approval, validation decision, and final sync preview approval.
- FR-RG-005: SpecForge shall require explicit user approval to pass each hard gate by default.
- FR-RG-006: SpecForge shall not auto-advance hard gates unless user explicitly requests alternate behavior.
- FR-RG-007: Force completion shall always require explicit user command.
- FR-RG-008: Cancel workflow and sync retry shall be user-triggered by default.
- FR-RG-009: AI may auto-trigger cancel or sync retry only when explicitly authorized by user prompt or project rules.
