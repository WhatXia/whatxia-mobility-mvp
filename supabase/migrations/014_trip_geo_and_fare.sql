-- Sprint 23: origen/destino, ruta y tarifa en trips

alter table public.trips
  add column if not exists pickup_lat double precision;

alter table public.trips
  add column if not exists pickup_lng double precision;

alter table public.trips
  add column if not exists pickup_place_id text;

alter table public.trips
  add column if not exists pickup_label text;

alter table public.trips
  add column if not exists dropoff_lat double precision;

alter table public.trips
  add column if not exists dropoff_lng double precision;

alter table public.trips
  add column if not exists dropoff_place_id text;

alter table public.trips
  add column if not exists dropoff_label text;

alter table public.trips
  add column if not exists distance_meters integer;

alter table public.trips
  add column if not exists duration_seconds integer;

alter table public.trips
  add column if not exists quoted_fare integer;

alter table public.trips
  add column if not exists currency text not null default 'COP';
