-- Tarifas oficiales de Ibagué (negocio) → fare_rules SSoT
-- Solo actualiza la fila activa de Ibagué.
-- No toca time_*, wait_speed, horarios nocturnos ni geo aeropuerto
-- salvo los montos/parametrización de tarifa definidos aquí.

update public.fare_rules f
set
  flag_drop = 4500,
  minimum_fare = 6600,
  min_distance_meters = 1600,
  increment_meters = 80,
  increment_amount = 105,
  wait_seconds = 40,
  wait_amount = 90,
  surcharge_night = 1000,
  surcharge_sunday_holiday = 850,
  surcharge_airport = 6500,
  surcharge_whatxia = 800,
  updated_at = now()
from public.cities c
where f.city_id = c.id
  and c.slug = 'ibague'
  and f.active = true;
