-- PIONEERS-004 — Auditoría e idempotencia del lanzamiento oficial de ciudad.
-- Un programa solo puede lanzar la ciudad una vez (unique program_id).

create table if not exists public.launch_program_city_launches (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.launch_programs (id) on delete cascade,
  city_id uuid,
  city_name text not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'partial', 'failed', 'skipped')),
  trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'auto_end', 'api')),
  actor_label text not null default 'SYSTEM',
  actor_email text,
  actor_id uuid,
  activation_run_id uuid
    references public.launch_program_activation_runs (id) on delete set null,
  users_activated integer not null default 0,
  messages_sent integer not null default 0,
  messages_failed integer not null default 0,
  duration_ms integer,
  cms_message_code text not null default 'CITY_LAUNCH_MESSAGE',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  constraint launch_program_city_launches_program_unique unique (program_id)
);

create index if not exists launch_program_city_launches_started_idx
  on public.launch_program_city_launches (started_at desc);

comment on table public.launch_program_city_launches is
  'PIONEERS-004: auditoría del lanzamiento oficial de ciudad (1 por programa).';

alter table public.launch_program_city_launches enable row level security;

drop policy if exists launch_program_city_launches_deny_all
  on public.launch_program_city_launches;
create policy launch_program_city_launches_deny_all
  on public.launch_program_city_launches
  for all using (false) with check (false);

-- Best-effort: sembrar mensaje CMS CITY_LAUNCH_MESSAGE si existe bot_messages.
do $$
begin
  if to_regclass('public.bot_messages') is null then
    return;
  end if;

  insert into public.bot_messages (
    code,
    name,
    module,
    category,
    body,
    content_type,
    status,
    is_active,
    interactive_payload
  )
  values (
    'CITY_LAUNCH_MESSAGE',
    'Lanzamiento oficial de ciudad',
    'PIONEERS',
    'PIONEERS',
    E'🚀 ¡{{nombre}}, WhatXia ya está activo en {{ciudad}}!\n\nYa puedes solicitar tu primer servicio. Bienvenido al lanzamiento.',
    'interactive',
    'PUBLISHED',
    true,
    jsonb_build_object(
      'buttons',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'solicitar_servicio',
          'title', '🚖 Solicitar servicio'
        )
      )
    )
  )
  on conflict (code) do nothing;
exception
  when undefined_column then
    null;
  when others then
    raise notice 'PIONEERS-004: no se pudo sembrar CITY_LAUNCH_MESSAGE: %', sqlerrm;
end $$;
