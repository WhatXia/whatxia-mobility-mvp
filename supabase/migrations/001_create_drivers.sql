create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text not null,
  plate text not null,
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists drivers_phone_idx on public.drivers (phone);
