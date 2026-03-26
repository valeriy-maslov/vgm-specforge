create schema if not exists {{schema}};

create table if not exists {{schema}}.sf_workflow_runs (
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

create table if not exists {{schema}}.sf_workflow_events (
  id text primary key,
  branch_name text not null,
  started_at timestamptz not null,
  event_type text not null,
  actor_kind text not null,
  actor_id text,
  payload jsonb not null,
  created_at timestamptz not null,
  foreign key (branch_name, started_at)
    references {{schema}}.sf_workflow_runs(branch_name, started_at)
    on delete cascade
);
