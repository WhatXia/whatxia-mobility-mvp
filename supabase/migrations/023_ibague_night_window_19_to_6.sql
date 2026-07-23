-- Horario nocturno oficial Ibagué: 19:00 → 05:59:59
-- night_end_hour es exclusivo a nivel de hora (hora < end):
--   end = 6 incluye 05:00–05:59:59 y excluye desde 06:00:00.

update public.fare_rules f
set
  night_start_hour = 19,
  night_end_hour = 6,
  updated_at = now()
from public.cities c
where f.city_id = c.id
  and c.slug = 'ibague'
  and f.active = true;
