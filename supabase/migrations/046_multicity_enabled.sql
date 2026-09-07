-- Multi-ciudad: varias ciudades habilitadas a la vez.
-- Fuente operacional del viaje = trips.city_id (no una única "active city").

-- 1) Permitir Ibagué + Pasto (y N ciudades) habilitadas simultáneamente.
drop index if exists public.cities_one_active_idx;

create index if not exists cities_enabled_idx
  on public.cities (active)
  where active = true;

create index if not exists drivers_city_id_idx
  on public.drivers (city_id);

create index if not exists trips_city_id_idx
  on public.trips (city_id);

create index if not exists passengers_city_id_idx
  on public.passengers (city_id);

-- 2) Pasto como ciudad habilitada (dato, no código).
-- Centro urbano ≈ Plaza de Nariño. Radio 20 km cubre casco urbano + periferia.
-- Tarifas comerciales de Pasto: PENDIENTES. No se inserta fare_rules inventada.
-- Cotizar/finalizar en Pasto falla cerrado hasta que exista fila activa en fare_rules.
insert into public.cities (
  slug, name, region, country_code,
  center_lat, center_lng, radius_meters, active
)
select
  'pasto',
  'Pasto',
  'Nariño',
  'CO',
  1.2136,
  -77.2811,
  20000,
  true
where not exists (select 1 from public.cities where slug = 'pasto');

comment on table public.cities is
  'Ciudades de operación WhatXia. active=true = habilitada. Pueden coexistir varias.';
