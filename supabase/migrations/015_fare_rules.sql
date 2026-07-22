-- Sprint 25: reglas comerciales WhatXia (parametrizadas)

create table if not exists public.fare_rules (
  id uuid primary key default gen_random_uuid(),
  active boolean not null default true,
  currency text not null default 'COP',
  -- Tarifa oficial taxi
  flag_drop integer not null,
  minimum_fare integer not null,
  min_distance_meters integer not null,
  increment_meters integer not null,
  increment_amount integer not null,
  wait_seconds integer not null,
  wait_amount integer not null,
  -- Recargos
  surcharge_night integer not null,
  surcharge_sunday_holiday integer not null,
  surcharge_airport integer not null,
  surcharge_whatxia integer not null,
  -- Ventana nocturna [start, end) con wrap (ej. 20 → 5)
  night_start_hour integer not null,
  night_end_hour integer not null,
  -- Festivos ISO dates: ["2026-01-01", ...]
  holiday_dates jsonb not null default '[]'::jsonb,
  -- Detección aeropuerto
  airport_keywords jsonb not null default '[]'::jsonb,
  airport_center_lat double precision,
  airport_center_lng double precision,
  airport_radius_meters integer,
  updated_at timestamptz not null default now(),
  constraint fare_rules_night_hours_check
    check (
      night_start_hour between 0 and 23
      and night_end_hour between 0 and 23
    )
);

create unique index if not exists fare_rules_one_active_idx
  on public.fare_rules (active)
  where active = true;

insert into public.fare_rules (
  active,
  currency,
  flag_drop,
  minimum_fare,
  min_distance_meters,
  increment_meters,
  increment_amount,
  wait_seconds,
  wait_amount,
  surcharge_night,
  surcharge_sunday_holiday,
  surcharge_airport,
  surcharge_whatxia,
  night_start_hour,
  night_end_hour,
  holiday_dates,
  airport_keywords,
  airport_center_lat,
  airport_center_lng,
  airport_radius_meters
)
select
  true,
  'COP',
  4500,
  6600,
  1600,
  80,
  105,
  40,
  90,
  1000,
  1000,
  6500,
  1000,
  20,
  5,
  '[]'::jsonb,
  '["aeropuerto", "airport", "alfonso bonilla"]'::jsonb,
  3.5583,
  -76.3817,
  2500
where not exists (
  select 1 from public.fare_rules where active = true
);
