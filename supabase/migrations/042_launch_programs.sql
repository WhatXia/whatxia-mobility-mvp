-- CFG-001 — Programas de Lanzamiento (multi-programa; seed Pioneros Usuarios)
-- Shared Supabase: panel administra; bot solo lee / procesa cola de mensajes.
-- Canónico también en operations-panel/008_launch_programs.sql

create table if not exists public.launch_programs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  max_quota integer,
  auto_activate_on_end boolean not null default true,
  welcome_message text,
  activation_message text,
  mass_activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint launch_programs_code_format check (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint launch_programs_max_quota_check check (max_quota is null or max_quota > 0),
  constraint launch_programs_dates_check check (
    starts_at is null or ends_at is null or ends_at >= starts_at
  )
);

create table if not exists public.launch_program_activation_runs (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.launch_programs (id) on delete cascade,
  activated_count integer not null default 0,
  trigger_source text not null default 'manual',
  actor_email text,
  actor_id uuid,
  activation_message_queued boolean not null default false,
  created_at timestamptz not null default now(),
  constraint launch_program_activation_runs_source_check
    check (trigger_source in ('manual', 'auto_end', 'api'))
);

create table if not exists public.launch_program_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.launch_programs (id) on delete cascade,
  activation_run_id uuid references public.launch_program_activation_runs (id) on delete set null,
  passenger_id uuid references public.passengers (id) on delete set null,
  phone text not null,
  body text not null,
  status text not null default 'pending',
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint launch_program_outbound_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped'))
);

create index if not exists launch_programs_active_idx
  on public.launch_programs (is_active);

create index if not exists launch_program_outbound_pending_idx
  on public.launch_program_outbound_messages (status, created_at)
  where status = 'pending';

comment on table public.launch_programs is
  'CFG-001: configuración de programas de lanzamiento (Pioneros, Beta, etc.).';

comment on table public.launch_program_outbound_messages is
  'Cola de mensajes de activación masiva; el bot (o el panel) los envía por WhatsApp.';

alter table public.launch_programs enable row level security;
alter table public.launch_program_activation_runs enable row level security;
alter table public.launch_program_outbound_messages enable row level security;

drop policy if exists launch_programs_deny_all on public.launch_programs;
create policy launch_programs_deny_all
  on public.launch_programs for all using (false) with check (false);

drop policy if exists launch_program_activation_runs_deny_all on public.launch_program_activation_runs;
create policy launch_program_activation_runs_deny_all
  on public.launch_program_activation_runs for all using (false) with check (false);

drop policy if exists launch_program_outbound_messages_deny_all on public.launch_program_outbound_messages;
create policy launch_program_outbound_messages_deny_all
  on public.launch_program_outbound_messages for all using (false) with check (false);

create or replace function public.deactivate_launch_program(
  p_program_id uuid,
  p_trigger_source text default 'manual',
  p_actor_email text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program public.launch_programs%rowtype;
  v_run_id uuid;
  v_count integer := 0;
  v_queued boolean := false;
  v_source text := coalesce(nullif(trim(p_trigger_source), ''), 'manual');
  v_has_message boolean := false;
begin
  if v_source not in ('manual', 'auto_end', 'api') then
    v_source := 'manual';
  end if;

  select * into v_program
  from public.launch_programs
  where id = p_program_id
  for update;

  if not found then
    raise exception 'launch_program_not_found';
  end if;

  if not v_program.is_active then
    return jsonb_build_object(
      'ok', true,
      'already_inactive', true,
      'activated_count', 0,
      'run_id', null,
      'queued_messages', false
    );
  end if;

  update public.launch_programs
  set
    is_active = false,
    mass_activated_at = now(),
    updated_at = now()
  where id = p_program_id;

  v_has_message :=
    v_program.activation_message is not null
    and length(trim(v_program.activation_message)) > 0;

  with updated as (
    update public.passengers
    set status = 'ACTIVE'
    where status = 'PIONEER'
    returning id, phone, preferred_name, full_name, name
  ),
  counted as (
    select count(*)::integer as n from updated
  ),
  run_ins as (
    insert into public.launch_program_activation_runs (
      program_id,
      activated_count,
      trigger_source,
      actor_email,
      actor_id,
      activation_message_queued
    )
    select
      p_program_id,
      counted.n,
      v_source,
      p_actor_email,
      p_actor_id,
      (v_has_message and counted.n > 0)
    from counted
    returning id, activated_count, activation_message_queued
  ),
  msg_ins as (
    insert into public.launch_program_outbound_messages (
      program_id,
      activation_run_id,
      passenger_id,
      phone,
      body,
      status
    )
    select
      p_program_id,
      run_ins.id,
      u.id,
      u.phone,
      replace(
        replace(
          replace(
            v_program.activation_message,
            '{{nombre}}',
            coalesce(
              nullif(trim(u.preferred_name), ''),
              nullif(trim(u.full_name), ''),
              nullif(trim(u.name), ''),
              'Pionero'
            )
          ),
          '{{name}}',
          coalesce(
            nullif(trim(u.preferred_name), ''),
            nullif(trim(u.full_name), ''),
            nullif(trim(u.name), ''),
            'Pionero'
          )
        ),
        '{{Nombre}}',
        coalesce(
          nullif(trim(u.preferred_name), ''),
          nullif(trim(u.full_name), ''),
          nullif(trim(u.name), ''),
          'Pionero'
        )
      ),
      'pending'
    from updated u
    cross join run_ins
    where v_has_message
    returning id
  )
  select
    run_ins.id,
    run_ins.activated_count,
    run_ins.activation_message_queued
      or exists (select 1 from msg_ins)
  into v_run_id, v_count, v_queued
  from run_ins;

  return jsonb_build_object(
    'ok', true,
    'already_inactive', false,
    'activated_count', coalesce(v_count, 0),
    'run_id', v_run_id,
    'queued_messages', coalesce(v_queued, false)
  );
end;
$$;

revoke all on function public.deactivate_launch_program(uuid, text, text, uuid) from public;
grant execute on function public.deactivate_launch_program(uuid, text, text, uuid) to service_role;

insert into public.launch_programs (
  code,
  name,
  description,
  is_active,
  starts_at,
  ends_at,
  max_quota,
  auto_activate_on_end,
  welcome_message,
  activation_message
)
values (
  'PIONEERS_USERS',
  'Pioneros',
  'Programa de pre-lanzamiento para usuarios finales (WhatsApp).',
  true,
  null,
  null,
  200,
  true,
  E'🎉 ¡{{nombre}}, ya eres un Pionero de WhatXia!\n\nTu registro quedó confirmado.\n\nDesde hoy haces parte de los primeros colombianos en descubrir una nueva forma de vivir la movilidad.\n\nMuy pronto recibirás noticias exclusivas y el acceso al lanzamiento oficial.\n\n🚀 Gracias por creer en WhatXia desde el principio. Lo mejor está por comenzar.',
  E'🚀 ¡{{nombre}}, WhatXia ya está activo para ti!\n\nYa puedes solicitar tu primer servicio. Bienvenido al lanzamiento.'
)
on conflict (code) do nothing;
