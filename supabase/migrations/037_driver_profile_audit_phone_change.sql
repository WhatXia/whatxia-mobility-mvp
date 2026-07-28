-- DRIVER-004: auditoría de cambios de perfil + solicitudes de cambio de WhatsApp.

create table if not exists public.driver_profile_audits (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers (id) on delete cascade,
  field_name text not null,
  old_value text,
  new_value text,
  source text not null default 'WhatsApp',
  created_at timestamptz not null default now()
);

create index if not exists driver_profile_audits_driver_idx
  on public.driver_profile_audits (driver_id, created_at desc);

comment on table public.driver_profile_audits is
  'Auditoría de cambios de datos del conductor (origen WhatsApp u otros).';

create table if not exists public.driver_phone_change_requests (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers (id) on delete cascade,
  old_phone text not null,
  new_phone text not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists driver_phone_change_new_phone_idx
  on public.driver_phone_change_requests (new_phone, status);

create index if not exists driver_phone_change_driver_idx
  on public.driver_phone_change_requests (driver_id, created_at desc);

comment on table public.driver_phone_change_requests is
  'AUTH-WA-002: cambio de número WhatsApp pendiente de confirmación en el nuevo teléfono.';
