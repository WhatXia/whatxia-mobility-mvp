-- Enriquecimiento taxímetro de prueba (solo si 025 temprana ya estaba aplicada).

alter table public.taximeter_test_sessions
  add column if not exists route_provider text,
  add column if not exists route_polyline text,
  add column if not exists route jsonb not null default '{}'::jsonb;

alter table public.taximeter_test_runs
  add column if not exists pickup_type text,
  add column if not exists pickup_surcharge integer not null default 0,
  add column if not exists route_provider text not null default 'google_maps',
  add column if not exists pricing_engine_version text not null default 'v1',
  add column if not exists route_polyline text,
  add column if not exists route jsonb not null default '{}'::jsonb;

-- Migrar service_type → pickup_type si existía el esquema inicial.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'taximeter_test_runs'
      and column_name = 'service_type'
  ) then
    update public.taximeter_test_runs
    set pickup_type = coalesce(pickup_type, service_type)
    where pickup_type is null;

    alter table public.taximeter_test_runs drop column service_type;
  end if;
end $$;

create index if not exists taximeter_test_runs_engine_version_idx
  on public.taximeter_test_runs (pricing_engine_version);
