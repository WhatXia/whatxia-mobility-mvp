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
  unique (trip_id),
  constraint conversation_tunnels_status_check
    check (status in ('active', 'closed'))
);

create index if not exists conversation_tunnels_passenger_idx
  on public.conversation_tunnels (passenger_phone, status);

create index if not exists conversation_tunnels_driver_idx
  on public.conversation_tunnels (driver_phone, status);

create index if not exists conversation_tunnels_closes_at_idx
  on public.conversation_tunnels (closes_at)
  where status = 'active' and closes_at is not null;

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
