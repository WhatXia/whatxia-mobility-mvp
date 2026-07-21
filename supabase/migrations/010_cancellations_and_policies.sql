-- Sprint 20: cancelaciones, causales, contadores y suspensión

alter table public.drivers
  add column if not exists cancel_policy_count integer not null default 0;

alter table public.drivers
  add column if not exists suspended_until timestamptz;

alter table public.passengers
  add column if not exists no_show_count integer not null default 0;

create table if not exists public.trip_cancellations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id),
  cancelled_by text not null,
  driver_id uuid references public.drivers (id),
  passenger_id uuid references public.passengers (id),
  causal text,
  created_at timestamptz not null default now(),
  constraint trip_cancellations_by_check
    check (cancelled_by in ('passenger', 'driver')),
  constraint trip_cancellations_causal_check
    check (
      causal is null
      or causal in (
        'problema_mecanico',
        'cliente_no_recogido',
        'no_puedo_llegar'
      )
    )
);

create index if not exists trip_cancellations_trip_idx
  on public.trip_cancellations (trip_id);

create index if not exists trip_cancellations_driver_idx
  on public.trip_cancellations (driver_id, created_at);

create index if not exists trip_cancellations_passenger_idx
  on public.trip_cancellations (passenger_id, created_at);

create index if not exists drivers_suspended_until_idx
  on public.drivers (suspended_until)
  where suspended_until is not null;
