-- Favoritos inteligentes de recorridos (origen + destino completos).
-- Máximo 2 por pasajero (enforce en aplicación; sprint actual sin reemplazo).

create table if not exists public.route_favorites (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.passengers (id) on delete cascade,
  name text not null,
  -- Origen
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  pickup_label text not null,
  pickup_place_id text,
  -- Destino
  dropoff_lat double precision not null,
  dropoff_lng double precision not null,
  dropoff_label text not null,
  dropoff_place_id text,
  -- Referencia opcional al viaje que originó el favorito
  trip_id uuid references public.trips (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_favorites_name_not_blank check (char_length(trim(name)) > 0)
);

create index if not exists route_favorites_passenger_idx
  on public.route_favorites (passenger_id);

create index if not exists route_favorites_passenger_updated_idx
  on public.route_favorites (passenger_id, updated_at desc);

comment on table public.route_favorites is
  'Recorridos favoritos del pasajero (origen + destino). Máx. 2 por passenger_id (app).';
