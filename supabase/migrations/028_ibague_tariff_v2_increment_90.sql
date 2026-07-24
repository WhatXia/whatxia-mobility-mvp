-- Tarifa Ibagué v2: incremento de distancia $90 / 80 m (excedente tras 1.600 m).
-- La lógica de cálculo (mínima + excedente) vive en el Tariff Engine;
-- aquí solo se alinea el monto del tick en fare_rules.

update public.fare_rules f
set
  increment_amount = 90,
  updated_at = now()
from public.cities c
where f.city_id = c.id
  and c.slug = 'ibague'
  and f.active = true;
