-- Sprint 18 completo: pegar en Supabase → SQL Editor → Run
-- Incluye 007 + 008 + 009 (idempotente donde es posible)

-- 007: tablas del túnel
create table if not exists public.conversation_tunnels (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id),
  passenger_phone text not null,
  driver_phone text not null,
  status text not null default 'active',
  opened_at timestamptz not null default now(),
  closes_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (trip_id)
);

create table if not exists public.tunnel_messages (
  id uuid primary key default gen_random_uuid(),
  tunnel_id uuid not null references public.conversation_tunnels (id) on delete cascade,
  trip_id uuid not null references public.trips (id),
  sender_phone text not null,
  recipient_phone text not null,
  sender_role text not null,
  content text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint tunnel_messages_role_check
    check (sender_role in ('passenger', 'driver')),
  constraint tunnel_messages_status_check
    check (status in ('pending', 'sent', 'failed'))
);

create index if not exists tunnel_messages_trip_idx
  on public.tunnel_messages (trip_id, created_at);

create index if not exists tunnel_messages_tunnel_idx
  on public.tunnel_messages (tunnel_id, created_at);

create index if not exists conversation_tunnels_passenger_idx
  on public.conversation_tunnels (passenger_phone, status);

create index if not exists conversation_tunnels_driver_idx
  on public.conversation_tunnels (driver_phone, status);

-- 008: estados active | closing | closed
alter table public.conversation_tunnels
  drop constraint if exists conversation_tunnels_status_check;

alter table public.conversation_tunnels
  add constraint conversation_tunnels_status_check
  check (status in ('active', 'closing', 'closed'));

drop index if exists conversation_tunnels_closes_at_idx;

create index if not exists conversation_tunnels_closes_at_idx
  on public.conversation_tunnels (closes_at)
  where status = 'closing' and closes_at is not null;

-- 009: viaje CANCELLED
alter table public.trips
  drop constraint if exists trips_status_check;

alter table public.trips
  add constraint trips_status_check
  check (
    status in (
      'SEARCHING',
      'ASSIGNED',
      'ETA_INFORMED',
      'DRIVER_ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED'
    )
  );
