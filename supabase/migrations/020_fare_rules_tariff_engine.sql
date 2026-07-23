-- Sprint: Tariff Engine SSoT — columnas faltantes en fare_rules
-- Fuente operativa = public.fare_rules (no city-config/*.ts)

alter table public.fare_rules
  add column if not exists time_unit_seconds integer not null default 0;

alter table public.fare_rules
  add column if not exists time_amount integer not null default 0;

alter table public.fare_rules
  add column if not exists wait_speed_threshold_kmh numeric not null default 5;

-- Ibagué: tiempo de marcha no aplica; umbral de espera por velocidad = 5 km/h
-- Aeropuerto: se conserva el modelo de 017 (Perales, radio 3000).
update public.fare_rules f
set
  time_unit_seconds = 0,
  time_amount = 0,
  wait_speed_threshold_kmh = 5,
  updated_at = now()
from public.cities c
where f.city_id = c.id
  and c.slug = 'ibague'
  and f.active = true;
