-- SYS-001 — Estado operativo del bot (Activo / Mantenimiento)
-- Fuente de verdad compartida: panel Ops escribe; bot lee en cada mensaje.

create table if not exists public.bot_operational_status (
  id smallint primary key default 1 check (id = 1),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'MAINTENANCE')),
  maintenance_message text not null default
    E'👋 Hola. En este momento estamos realizando una actualización programada. En unos minutos volveremos a estar disponibles. Gracias por tu comprensión.',
  cms_message_code text not null default 'SYS_BOT_MAINTENANCE',
  updated_at timestamptz not null default now(),
  updated_by_email text,
  updated_by_id uuid,
  created_at timestamptz not null default now()
);

comment on table public.bot_operational_status is
  'SYS-001: estado operativo global del bot WhatsApp (ACTIVE | MAINTENANCE).';

comment on column public.bot_operational_status.maintenance_message is
  'Mensaje enviado a usuarios/conductores en MAINTENANCE. Editable desde Ops; código CMS SYS_BOT_MAINTENANCE.';

alter table public.bot_operational_status enable row level security;

drop policy if exists bot_operational_status_deny_all on public.bot_operational_status;
create policy bot_operational_status_deny_all
  on public.bot_operational_status for all using (false) with check (false);

insert into public.bot_operational_status (
  id,
  status,
  maintenance_message,
  cms_message_code
)
values (
  1,
  'ACTIVE',
  E'👋 Hola. En este momento estamos realizando una actualización programada. En unos minutos volveremos a estar disponibles. Gracias por tu comprensión.',
  'SYS_BOT_MAINTENANCE'
)
on conflict (id) do nothing;

-- Best-effort: alinear fila CMS si la tabla bot_messages ya existe (BOT-CMS-002).
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
    is_active
  )
  values (
    'SYS_BOT_MAINTENANCE',
    'Bot en mantenimiento',
    'SYSTEM',
    'SYSTEM',
    E'👋 Hola. En este momento estamos realizando una actualización programada. En unos minutos volveremos a estar disponibles. Gracias por tu comprensión.',
    'text',
    'PUBLISHED',
    true
  )
  on conflict (code) do nothing;
exception
  when undefined_column then
    -- Esquema CMS distinto: el mensaje vive en bot_operational_status.
    null;
  when others then
    raise notice 'SYS-001: no se pudo sembrar bot_messages.SYS_BOT_MAINTENANCE: %', sqlerrm;
end $$;
