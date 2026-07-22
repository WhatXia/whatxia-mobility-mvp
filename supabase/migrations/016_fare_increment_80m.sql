-- Sprint 25 ajuste: incremento de distancia cada 80 m (antes 60 m)

update public.fare_rules
set
  increment_meters = 80,
  updated_at = now()
where active = true;
