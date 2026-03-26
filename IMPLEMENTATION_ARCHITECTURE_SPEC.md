# SpecForge Implementation Architecture Spec (MVP)

This document is the implementation-ready blueprint for building SpecForge.

It defines:

- concrete package/component layout
- module API contracts
- command-by-command responsibility matrix

It is aligned with `ARCHITECTURE.md`, `SPECFORGE_MVP_EVENT_STORMING.md`, and `specs/index.md`.

## 1) Blueprint Scope

MVP scope in this blueprint:

- workspace-packable Node.js CLI (`specforge`) with release-path compatibility for npm publish
- unified workflow engine (`feature`, `refinement`, `refactor`)
- hard-gate control model
- PostgreSQL audit driver
- local markdown master-doc storage
- pluggable interfaces for future drivers/plugins
- managed non-editable SpecForge system assets

## 2) Monorepo Package Layout

```text
/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/
    contracts/
      src/
        index.ts
        workflow.ts
        events.ts
        rules.ts
        config.ts
        ports.ts
    domain/
      src/
        index.ts
        state-machine/
          states.ts
          transitions.ts
          guards.ts
        policies/
          hard-gates.ts
          rule-precedence.ts
          branch-identity.ts
          force-completion.ts
          retention.ts
        models/
          workflow-run.ts
          gate-decision.ts
          scope-map.ts
    application/
      src/
        index.ts
        services/
          init-service.ts
          system-service.ts
          config-service.ts
          workflow-service.ts
          scope-service.ts
          spec-service.ts
          plan-service.ts
          validation-service.ts
          completion-service.ts
          drift-service.ts
          audit-service.ts
        orchestration/
          command-context.ts
          idempotency.ts
          rule-evaluation.ts
          event-emitter.ts
    adapters-git/
      src/
        index.ts
        git-cli-adapter.ts
    adapters-audit-postgres/
      src/
        index.ts
        pg-audit-driver.ts
      migrations/
        001_init.sql
        002_indexes.sql
    adapters-docs-local-md/
      src/
        index.ts
        local-doc-store.ts
        atomic-writer.ts
        section-id.ts
    adapters-system-assets/
      src/
        index.ts
        asset-manifest.ts
        managed-system-assets-adapter.ts
        asset-updater.ts
        checksum.ts
    cli/
      src/
        bin/
          specforge.ts
        commands/
          init.ts
          system.ts
          config.ts
          workflow.ts
          scope.ts
          spec.ts
          plan.ts
          validate.ts
          complete.ts
          drift.ts
          audit.ts
        output/
          human.ts
          json.ts
        composition/
          container.ts
          plugin-loader.ts
```

## 3) Package Responsibilities and Dependency Rules

### 3.1 Responsibility Split

- `@specforge/contracts`: shared types, command DTOs, ports, event envelopes.
- `@specforge/domain`: pure business rules (states, policies, transition guards).
- `@specforge/application`: use-case orchestration and transaction boundaries.
- `@specforge/adapters-git`: Git operations (branching, drift checks, merges).
- `@specforge/adapters-audit-postgres`: PostgreSQL `AuditDriver`.
- `@specforge/adapters-docs-local-md`: local markdown `MasterDocStore`.
- `@specforge/adapters-system-assets`: managed prompts/skills/system-file updates.
- `@specforge/cli`: command parsing, output formatting, composition root.

### 3.2 Allowed Dependencies

- `cli` -> `application`, `contracts`, adapters (via composition)
- `application` -> `domain`, `contracts`
- adapters -> `contracts`
- `domain` -> `contracts` only
- `contracts` -> no internal package dependencies

No adapter may be imported directly by `domain`.

## 4) Core Module APIs

## 4.1 Contracts Package (`@specforge/contracts`)

```ts
export type WorkType = "feature" | "refinement" | "refactor";

export type WorkflowState =
  | "intake"
  | "scope_confirmed"
  | "spec_drafting"
  | "spec_approved"
  | "plan_drafting"
  | "plan_approved"
  | "implementing"
  | "validation"
  | "rework"
  | "ready_to_complete"
  | "completed"
  | "cancelled";

export interface Actor {
  kind: "user" | "agent" | "system";
  id?: string;
}

export interface WorkflowRunKey {
  branchName: string;
  startedAt: string; // ISO timestamp
}

export interface WorkflowRun {
  key: WorkflowRunKey;
  workType: WorkType;
  state: WorkflowState;
  title: string;
  affectedSectionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  run: WorkflowRunKey;
  type: string;
  actor: Actor;
  createdAt: string;
  payload: Record<string, unknown>;
}
```

```ts
export interface AuditDriver {
  connect(config: unknown): Promise<void>;
  append(event: AuditEvent): Promise<void>;
  query(filter: AuditQuery): Promise<AuditEvent[]>;
  getRun(run: WorkflowRunKey): Promise<WorkflowRun | null>;
  saveRun(run: WorkflowRun): Promise<void>;
  close(): Promise<void>;
}

export interface MasterDocStore {
  load(ref: DocRef): Promise<DocContent>;
  planSync(changeSet: SyncChangeSet): Promise<SyncPreview>;
  applySync(changeSet: SyncChangeSet): Promise<SyncResult>; // atomic
}

export interface GitPort {
  currentBranch(): Promise<string>;
  branchExists(name: string): Promise<boolean>;
  createBranch(name: string): Promise<void>;
  mergeMainIntoCurrent(mainBranch: string, strategy?: "merge-main" | "rebase-main"): Promise<MergeResult>;
  isMainDrifted(mainBranch: string): Promise<boolean>;
  listDriftPaths(mainBranch: string): Promise<string[]>;
  headSha(branch: string): Promise<string>;
  detectConflictFiles(): Promise<string[]>;
  markConflictFilesResolved(files: readonly string[]): Promise<void>;
  continueMerge(message?: string): Promise<void>;
  abortMerge(): Promise<void>;
}

export interface PullRequestPort {
  create(input: {
    branchName: string;
    title: string;
    body?: string;
  }): Promise<{
    url: string;
    number?: number;
  }>;
}
```

## 4.2 Domain Package (`@specforge/domain`)

```ts
export interface RuleSources {
  prompt?: RuleSet;
  constitution?: RuleSet;
  agentsMd?: RuleSet;
  readmeMd?: RuleSet;
}

export interface EffectiveRules {
  validationChecks: string[];
  branchNamingPattern: string;
  driftStrategy: "merge-main" | "rebase-main";
  autoAdvanceHardGates: boolean;
}

export function resolveEffectiveRules(sources: RuleSources): EffectiveRules;
```

```ts
export interface TransitionInput {
  run: WorkflowRun;
  action: DomainAction;
  nowIso: string;
  rules: EffectiveRules;
}

export interface TransitionResult {
  nextRun: WorkflowRun;
  events: AuditEvent[];
  blockedReason?: string;
}

export function transitionWorkflow(input: TransitionInput): TransitionResult;
export function requiresHardGateApproval(action: DomainAction): boolean;
export function isForceCompletionRequired(args: {
  unresolvedFailedGates: string[];
  explicitForceCommand: boolean;
}): boolean;
```

## 4.3 Application Package (`@specforge/application`)

```ts
export interface CommandContext {
  actor: Actor;
  cwd: string;
  projectRoot: string;
  run?: WorkflowRunKey;
  requestId: string;
}

export interface WorkflowService {
  start(input: StartWorkflowInput, ctx: CommandContext): Promise<StartWorkflowOutput>;
  status(input: WorkflowStatusInput, ctx: CommandContext): Promise<WorkflowStatusOutput>;
  cancel(input: WorkflowCancelInput, ctx: CommandContext): Promise<WorkflowCancelOutput>;
}

export interface ScopeService {
  analyze(input: ScopeAnalyzeInput, ctx: CommandContext): Promise<ScopeAnalyzeOutput>;
  confirm(input: ScopeConfirmInput, ctx: CommandContext): Promise<ScopeConfirmOutput>;
}

export interface CompletionService {
  preview(input: CompletionPreviewInput, ctx: CommandContext): Promise<CompletionPreviewOutput>;
  approve(input: CompletionApproveInput, ctx: CommandContext): Promise<CompletionApproveOutput>;
  sync(input: CompletionSyncInput, ctx: CommandContext): Promise<CompletionSyncOutput>;
  force(input: ForceCompletionInput, ctx: CommandContext): Promise<ForceCompletionOutput>;
}
```

`ValidationRunInput` and `CompletionSyncInput` both support checkpoint drift options:

- `mainBranch?: string` (default `main`)
- `approveDriftAnalysis?: boolean` (required when automated drift integration runs)

`CompletionSyncInput` additionally supports optional PR request fields:

- `requestPullRequest?: boolean`
- `pullRequestTitle?: string`
- `pullRequestBody?: string`

Application services orchestrate:

- rule evaluation at hard gates
- domain transitions
- adapter calls (git, audit, doc store, assets)
- event persistence

## 4.4 PostgreSQL Audit Driver (`@specforge/adapters-audit-postgres`)

`001_init.sql` minimum schema:

```sql
create table if not exists sf_workflow_runs (
  branch_name text not null,
  started_at timestamptz not null,
  work_type text not null,
  state text not null,
  title text not null,
  affected_section_ids jsonb not null default '[]'::jsonb,
  unresolved_failed_gates jsonb not null default '[]'::jsonb,
  force_completion_requested boolean not null default false,
  metadata jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  cancelled_at timestamptz,
  completed_at timestamptz,
  primary key (branch_name, started_at)
);

create table if not exists sf_workflow_events (
  id text primary key,
  branch_name text not null,
  started_at timestamptz not null,
  event_type text not null,
  actor_kind text not null,
  actor_id text,
  payload jsonb not null,
  created_at timestamptz not null,
  foreign key (branch_name, started_at)
    references sf_workflow_runs(branch_name, started_at)
    on delete cascade
);
```

## 4.5 Local Markdown Doc Store (`@specforge/adapters-docs-local-md`)

Responsibilities:

- read/write canonical docs in repository
- generate missing stable section IDs during init
- produce sync preview diff model
- apply all file changes atomically (temp files + rename commit step)

API notes:

- `planSync()` must return deterministic operation list.
- `applySync()` must fail with no partial writes visible.

## 5) CLI Command Handlers and Service Entry Points

Command handler file layout:

```text
packages/cli/src/commands/
  init.ts
  system.ts
  config.ts
  workflow.ts
  scope.ts
  spec.ts
  plan.ts
  validate.ts
  complete.ts
  drift.ts
  audit.ts
```

Each command handler follows the same shape:

1. parse flags/options
2. build `CommandContext`
3. invoke one application service method
4. format output (`human` or `json`)

Shared runtime options are parsed by `packages/cli/src/commands/shared.ts` and include:

- `--project-root`
- `--actor-kind`
- `--actor-id`
- `--drift-strategy <merge-main|rebase-main>` (mapped into prompt rule source for precedence evaluation)

Runtime configuration prerequisites:

- `.specforge/config.yaml` is required for workflow/runtime commands and stores JSON content in MVP.
- `config.audit` is required.
- Supported audit drivers: `postgres` and `memory`.
- For `postgres`, `config.audit.connectionString` is required.

Minimal local/runtime config example:

```json
{
  "audit": {
    "driver": "memory"
  },
  "docsStore": {
    "provider": "local-md",
    "rootDir": "."
  }
}
```

## 6) Command-by-Command Responsibility Matrix

| CLI command | Application entrypoint | Domain responsibilities | Adapter calls | Main side effects |
| --- | --- | --- | --- | --- |
| `specforge init --mode new` | `InitService.initialize` | init policy, bundled approval requirement | local init workspace, initialization store | creates foundation artifacts and persists initialization state |
| `specforge init --mode existing` | `InitService.initialize` | reconciliation requirement, bundled approval requirement | local init workspace (scan + reconciliation report), initialization store | produces reconciliation report and persists initialization state |
| `specforge system update --assets-dir <path> [--manifest-path <path>] [--system-dir <path>] [--dry-run]` | `SystemService.updateManagedAssets` | managed-file policy | system-assets | updates `.specforge/system/*` via manifest/checksum from the provided assets bundle |
| `specforge config get` | `ConfigService.get` | none | filesystem/config | reads `.specforge/config.yaml` |
| `specforge config set` | `ConfigService.set` | config validation | filesystem/config | writes config |
| `specforge workflow start` | `WorkflowService.start` | infer work type, branch naming policy, one-active-workflow-per-branch | git, audit | creates branch, creates workflow run |
| `specforge workflow status` | `WorkflowService.status` | none | audit | returns current run/state summary |
| `specforge workflow cancel` | `WorkflowService.cancel` | terminal cancellation rules, retention rules | git, audit | marks run cancelled, stores minimal cancellation metadata |
| `specforge scope analyze` | `ScopeService.analyze` | scope proposal rules (strict IDs + free text) | audit | emits `scope_proposed` |
| `specforge scope confirm` | `ScopeService.confirm` | soft checkpoint transition to `scope_confirmed` | audit | updates run scope + emits `scope_confirmed` |
| `specforge spec draft` | `SpecService.draft` | state guard to drafting stage | audit | returns draft path contract and emits `spec_generated` |
| `specforge spec approve` | `SpecService.approve` | hard-gate check + rule evaluation | audit | transitions to `spec_approved`, emits gate decision |
| `specforge plan draft` | `PlanService.draft` | state guard + plan loop policy | audit | returns draft path contract and emits `plan_generated` |
| `specforge plan approve` | `PlanService.approve` | hard-gate check + rule evaluation | audit | transitions to `plan_approved` |
| `specforge validate run --approve-drift-analysis?` | `ValidationService.run` | pre-implementation drift check/integration + impact analysis confirmation + validation-rule resolution | git, audit, runner adapter (future) | may require drift confirmation, may transition to `rework`, writes validation results |
| `specforge validate decide --accepted/--changes-requested` | `ValidationService.decide` | hard-gate transition + rework policy | audit | enters `rework` or proceeds |
| `specforge complete preview` | `CompletionService.preview` | completion preconditions | docs-local-md, audit | outputs sync preview model |
| `specforge complete approve` | `CompletionService.approve` | hard-gate approval with resolved rules | audit | records `sync_preview_approved` |
| `specforge complete sync --approve-drift-analysis? --request-pr?` | `CompletionService.sync` | pre-completion drift check/integration + impact analysis confirmation + atomic sync policy + optional PR extension | git, docs-local-md, audit, optional PR port | may require drift confirmation, applies all-or-nothing sync, and may attempt non-blocking PR creation |
| `specforge complete force --reason ...` | `CompletionService.force` | force-completion policy/required fields | audit | records override context for final sync |
| `specforge drift check` | `DriftService.check` | drift-check policy (before impl/complete) | git, audit | emits `drift_detected` when applicable |
| `specforge drift merge-main` | `DriftService.mergeMain` | default strategy + override policy + conflict proposal generation | git, audit | integrates `main` into run branch and returns proposal when conflicts occur |
| `specforge drift resolve` | `DriftService.resolveConflicts` | proposal approval required before apply | git, audit | applies approved conflict resolution (auto-generated plan when none supplied) |
| `specforge audit query` | `AuditService.query` | none | audit driver | returns filtered event/run history |

## 7) Command Output Contracts

All commands support human output and machine output:

- `specforge <command>` -> human summary
- `specforge <command> --json` -> deterministic JSON envelope

JSON response envelope:

```ts
type CliResult<T> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; error: { code: string; message: string; details?: unknown } };
```

## 8) Runtime Project Footprint

Generated/managed structure in user repository:

```text
.specforge/
  config.yaml   # JSON content persisted at .yaml path for MVP compatibility
  system/
    prompts/
    skills/
    command-contracts/
    manifest.json
  state/
    runs/        # logical run artifact path contracts returned by draft services
```

Project docs (source-of-truth model):

- Root Master Spec
- Master Feature Specs
- Master Architecture Doc
- Master Implementation Doc
- Master Decision Log
- Change History

## 9) Implementation Sequencing (Package-first)

1. `contracts` + `domain`
2. `application` (services and transition orchestration)
3. `adapters-git` + `adapters-docs-local-md`
4. `adapters-audit-postgres`
5. `adapters-system-assets`
6. `cli` + composition root + command matrix
7. end-to-end workflow command tests

## 10) Test Strategy by Layer

- Domain: pure unit tests for state transitions and gate policies.
- Application: service tests with mocked ports.
- Adapters: integration tests (Git fixture repo, PostgreSQL test container, filesystem sandbox).
- CLI: command contract tests for both text and `--json` outputs.

## 11) Non-Negotiable MVP Invariants

- One active workflow per branch.
- Branch identity is workflow identity (`branch + timestamp` unique run key).
- Hard gates require explicit approval by default.
- Rule precedence for loaded sources is `prompt > constitution > AGENTS.md > README.md`.
- Sync is atomic all-or-nothing.
- Force completion is explicit and fully justified.
- Cancellation is terminal and keeps minimal metadata only.
