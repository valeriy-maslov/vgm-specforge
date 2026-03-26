create index if not exists sf_workflow_events_run_idx
  on {{schema}}.sf_workflow_events (branch_name, started_at, created_at);

create index if not exists sf_workflow_events_type_idx
  on {{schema}}.sf_workflow_events (event_type, created_at);

create index if not exists sf_workflow_runs_state_idx
  on {{schema}}.sf_workflow_runs (state, updated_at);
