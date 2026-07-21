create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  passenger_phone text not null,
  pickup_neighborhood text not null,
  status text not null default 'SEARCHING',
  driver_id uuid references public.drivers (id),
  driver_phone text,
  driver_name text,
  eta_minutes integer,
  rating integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trips_status_idx on public.trips (status);
create index if not exists trips_driver_phone_idx on public.trips (driver_phone);
create index if not exists trips_passenger_phone_idx on public.trips (passenger_phone);

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
      'COMPLETED'
    )
  );
