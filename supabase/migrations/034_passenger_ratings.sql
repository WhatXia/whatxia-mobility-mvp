-- Calificaciones del conductor hacia el pasajero (bidireccional).
-- Una calificación por viaje. Promedios se calculan en lectura (sin columnas denormalizadas).

create table if not exists public.passenger_ratings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  passenger_id uuid not null references public.passengers (id) on delete cascade,
  rating integer not null,
  created_at timestamptz not null default now(),
  constraint passenger_ratings_rating_allowed check (rating in (5, 4, 2)),
  constraint passenger_ratings_trip_unique unique (trip_id)
);

create index if not exists passenger_ratings_passenger_idx
  on public.passenger_ratings (passenger_id);

create index if not exists passenger_ratings_driver_idx
  on public.passenger_ratings (driver_id);

comment on table public.passenger_ratings is
  'Calificación del conductor al pasajero al finalizar el viaje. Promedio vía servicio reputation.';
