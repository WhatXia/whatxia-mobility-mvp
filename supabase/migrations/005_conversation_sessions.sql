create table if not exists public.conversation_sessions (
  phone text primary key,
  name text not null default '',
  state text not null,
  pickup_neighborhood text,
  driver_name text,
  driver_draft jsonb,
  driver_flow_step text,
  driver_update_category text,
  driver_update_field text,
  updated_at timestamptz not null default now()
);

create index if not exists conversation_sessions_state_idx
  on public.conversation_sessions (state);
