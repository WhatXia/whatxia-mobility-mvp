-- Sesión autenticada de conductor (separada de conversation_sessions y de is_available).
create table if not exists public.driver_auth_sessions (
  phone text primary key,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists driver_auth_sessions_driver_idx
  on public.driver_auth_sessions (driver_id);

comment on table public.driver_auth_sessions is
  'Sesión de login de conductor por teléfono WhatsApp. Independiente de disponibilidad operativa.';
