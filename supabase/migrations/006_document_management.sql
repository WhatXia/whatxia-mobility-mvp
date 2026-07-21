-- Sprint 17: gestión documental automática

alter table public.drivers
  add column if not exists status text not null default 'active';

alter table public.drivers
  drop constraint if exists drivers_status_check;

alter table public.drivers
  add constraint drivers_status_check
  check (status in ('active', 'inactive'));

create table if not exists public.document_reminders (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers (id) on delete cascade,
  document_type text not null,
  days_before integer not null,
  expires_on date not null,
  sent_at timestamptz not null default now(),
  unique (driver_id, document_type, days_before, expires_on)
);

create index if not exists document_reminders_driver_idx
  on public.document_reminders (driver_id);

comment on column public.drivers.status is
  'active | inactive — inactive cuando hay bloqueo documental';
comment on table public.document_reminders is
  'Evita recordatorios duplicados por documento/umbral/fecha de vencimiento';
