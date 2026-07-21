create table if not exists public.passengers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  created_at timestamptz not null default now()
);

create index if not exists passengers_phone_idx on public.passengers (phone);

alter table public.trips
  add column if not exists passenger_id uuid references public.passengers (id);

create index if not exists trips_passenger_id_idx on public.trips (passenger_id);
