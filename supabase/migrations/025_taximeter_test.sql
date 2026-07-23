-- Taxímetro de prueba: calibración tarifaria (independiente de Mobility / trips).

create table if not exists public.taximeter_test_sessions (
  phone text primary key,
  driver_id uuid references public.drivers (id) on delete set null,
  driver_name text,
  state text not null,
  started_at timestamptz,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,
  finished_at timestamptz,
  distance_meters double precision,
  duration_seconds integer,
  whatxia_fare integer,
  meter_value integer,
  route_provider text,
  route_polyline text,
  route jsonb not null default '{}'::jsonb,
  draft jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.taximeter_test_runs (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.drivers (id) on delete set null,
  driver_phone text not null,
  driver_name text,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  start_lat double precision not null,
  start_lng double precision not null,
  end_lat double precision not null,
  end_lng double precision not null,
  distance_meters double precision not null,
  duration_seconds integer not null,
  whatxia_fare integer not null,
  meter_value integer not null,
  difference_pesos integer not null,
  difference_percent numeric(10, 4) not null,
  pickup_type text not null check (pickup_type in ('calle', 'satelital')),
  pickup_surcharge integer not null default 0,
  route_provider text not null default 'google_maps',
  pricing_engine_version text not null default 'v1',
  route_polyline text,
  route jsonb not null default '{}'::jsonb,
  currency text not null default 'COP',
  city_slug text,
  created_at timestamptz not null default now()
);

create index if not exists taximeter_test_runs_created_at_idx
  on public.taximeter_test_runs (created_at desc);

create index if not exists taximeter_test_runs_driver_phone_idx
  on public.taximeter_test_runs (driver_phone);

create index if not exists taximeter_test_runs_engine_version_idx
  on public.taximeter_test_runs (pricing_engine_version);

comment on table public.taximeter_test_sessions is
  'Sesión activa del taxímetro de prueba (no es viaje Mobility).';

comment on table public.taximeter_test_runs is
  'Corridas de calibración taxímetro físico vs WhatXia. Fuente para análisis tarifario.';

comment on column public.taximeter_test_runs.route_provider is
  'Proveedor de ruta usado en la medición (google_maps, mapbox, haversine, …).';

comment on column public.taximeter_test_runs.pricing_engine_version is
  'Versión del motor tarifario WhatXia al momento de la prueba (v1, v1.1, …).';

comment on column public.taximeter_test_runs.pickup_type is
  'Calle o Satelital (contexto del taxímetro físico).';

comment on column public.taximeter_test_runs.pickup_surcharge is
  'Recargo COP asociado al pickup_type al momento de la prueba (histórico inmutable).';

comment on column public.taximeter_test_runs.route_polyline is
  'Polyline codificada del recorrido (si el proveedor la devolvió).';

comment on column public.taximeter_test_runs.route is
  'Snapshot JSON del recorrido (origen, destino, distancia, provider, polyline, fallback).';
