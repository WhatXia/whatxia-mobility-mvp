-- REF-003: Programa de referidos (conductores → pasajeros).
-- Alimenta estadísticas / auditoría del Operations Center sin procesos manuales.

alter table public.drivers
  add column if not exists referral_code text;

create unique index if not exists drivers_referral_code_uidx
  on public.drivers (referral_code)
  where referral_code is not null;

comment on column public.drivers.referral_code is
  'Código único de referido del conductor (formato DRV-XXXXX).';

alter table public.passengers
  add column if not exists referred_by_driver_id uuid
    references public.drivers (id) on delete set null;

create index if not exists passengers_referred_by_driver_idx
  on public.passengers (referred_by_driver_id)
  where referred_by_driver_id is not null;

comment on column public.passengers.referred_by_driver_id is
  'Conductor referente. Se asigna una sola vez; nunca se sobrescribe.';

-- Atribuciones consolidadas (1 pasajero → 1 referente).
create table if not exists public.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  referrer_driver_id uuid not null references public.drivers (id) on delete cascade,
  passenger_id uuid not null references public.passengers (id) on delete cascade,
  referral_code text not null,
  created_at timestamptz not null default now(),
  constraint referral_attributions_passenger_uidx unique (passenger_id)
);

create index if not exists referral_attributions_driver_idx
  on public.referral_attributions (referrer_driver_id, created_at desc);

comment on table public.referral_attributions is
  'Asociación definitiva pasajero ↔ conductor referente (fuente Ops Referidos).';

-- Auditoría de eventos (enlace usado, registro, etc.).
create table if not exists public.referral_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null
    check (event_type in ('link_opened', 'link_shared', 'passenger_registered')),
  referral_code text not null,
  referrer_driver_id uuid references public.drivers (id) on delete set null,
  passenger_id uuid references public.passengers (id) on delete set null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists referral_events_driver_idx
  on public.referral_events (referrer_driver_id, created_at desc);

create index if not exists referral_events_code_idx
  on public.referral_events (referral_code, created_at desc);

comment on table public.referral_events is
  'Auditoría: enlace utilizado, conductor referente, pasajero, fecha/hora.';

-- Código pendiente entre clic del enlace y primer mensaje WhatsApp / alta.
create table if not exists public.referral_pending (
  phone text primary key,
  referral_code text not null,
  created_at timestamptz not null default now()
);

comment on table public.referral_pending is
  'Código de referido pendiente de aplicar al crear el pasajero.';
