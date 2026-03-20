# SpecForge MVP Specs Index

This index lists MVP feature specs in recommended implementation order.

## Implementation Order

1. `01-init-foundation.md` - `init-foundation`
2. `02-master-doc-model.md` - `master-doc-model`
3. `03-branch-workflow-identity.md` - `branch-workflow-identity`
4. `04-workflow-state-machine.md` - `workflow-state-machine`
5. `05-rule-resolution-hard-gates.md` - `rule-resolution-hard-gates`
6. `06-scope-targeting.md` - `scope-targeting`
7. `07-spec-plan-authoring.md` - `spec-plan-authoring`
8. `08-validation-rework.md` - `validation-rework`
9. `09-completion-sync-force.md` - `completion-sync-force`
10. `10-main-drift-management.md` - `main-drift-management`
11. `11-audit-retention.md` - `audit-retention`
12. `12-optional-pr-integration.md` - `optional-pr-integration`

## Why This Order

- Start with project bootstrap and master-doc structure.
- Establish branch/workflow identity and lifecycle orchestration.
- Add governance and scope controls before drafting and planning loops.
- Add validation and completion sync once core loop exists.
- Add drift management after sync semantics are stable.
- Add full audit/retention and optional PR integration last.
