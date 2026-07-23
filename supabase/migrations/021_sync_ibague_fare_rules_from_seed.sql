-- Sincroniza fare_rules de Ibagué con src/lib/tariff/city-config/ibague.ts
-- Solo actualiza la fila activa de Ibagué. No inventa valores.

update public.fare_rules f
set
  currency = 'COP',
  flag_drop = 4500,
  minimum_fare = 6600,
  min_distance_meters = 1600,
  increment_meters = 80,
  increment_amount = 105,
  wait_seconds = 40,
  wait_amount = 90,
  time_unit_seconds = 0,
  time_amount = 0,
  wait_speed_threshold_kmh = 5,
  surcharge_night = 1000,
  surcharge_sunday_holiday = 1000,
  surcharge_airport = 6500,
  surcharge_whatxia = 1000,
  night_start_hour = 20,
  night_end_hour = 5,
  holiday_dates = '["2026-01-01"]'::jsonb,
  airport_keywords = '["aeropuerto", "perales"]'::jsonb,
  airport_center_lat = 4.4214,
  airport_center_lng = -75.1333,
  airport_radius_meters = 2500,
  updated_at = now()
from public.cities c
where f.city_id = c.id
  and c.slug = 'ibague'
  and f.active = true;
