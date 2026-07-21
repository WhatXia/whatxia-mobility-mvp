-- Sprint 21 ajuste: exclusión de conductor por viaje tras cancelar

create table if not exists public.trip_driver_exclusions (
  trip_id uuid not null references public.trips (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (trip_id, driver_id)
);

create index if not exists trip_driver_exclusions_driver_idx
  on public.trip_driver_exclusions (driver_id);
