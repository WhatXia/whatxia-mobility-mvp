-- Sprint 26: City Context — operación por ciudad (activa: Ibagué)

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  region text not null,
  country_code text not null default 'CO',
  center_lat double precision not null,
  center_lng double precision not null,
  radius_meters integer not null,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists cities_one_active_idx
  on public.cities (active)
  where active = true;

-- Ibagué, Tolima (ciudad activa)
insert into public.cities (
  slug, name, region, country_code,
  center_lat, center_lng, radius_meters, active
)
select
  'ibague',
  'Ibagué',
  'Tolima',
  'CO',
  4.4389,
  -75.2322,
  18000,
  true
where not exists (select 1 from public.cities where slug = 'ibague');

-- Asociar entidades a ciudad
alter table public.drivers
  add column if not exists city_id uuid references public.cities (id);

alter table public.passengers
  add column if not exists city_id uuid references public.cities (id);

alter table public.trips
  add column if not exists city_id uuid references public.cities (id);

alter table public.fare_rules
  add column if not exists city_id uuid references public.cities (id);

-- Backfill a Ibagué
update public.drivers d
set city_id = c.id
from public.cities c
where c.slug = 'ibague' and d.city_id is null;

update public.passengers p
set city_id = c.id
from public.cities c
where c.slug = 'ibague' and p.city_id is null;

update public.trips t
set city_id = c.id
from public.cities c
where c.slug = 'ibague' and t.city_id is null;

update public.fare_rules f
set city_id = c.id
from public.cities c
where c.slug = 'ibague' and f.city_id is null;

-- Una fila activa de tarifas por ciudad
drop index if exists public.fare_rules_one_active_idx;

create unique index if not exists fare_rules_one_active_per_city_idx
  on public.fare_rules (city_id)
  where active = true;

-- Aeropuerto Perales (Ibagué) en reglas activas
update public.fare_rules
set
  airport_keywords = '["aeropuerto", "airport", "perales"]'::jsonb,
  airport_center_lat = 4.4214,
  airport_center_lng = -75.1333,
  airport_radius_meters = 3000,
  updated_at = now()
where active = true;
