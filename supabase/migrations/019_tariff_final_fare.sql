-- Sprint Tariff Engine v1: timestamps de trayecto + tarifa final oficial

alter table public.trips
  add column if not exists started_at timestamptz;

alter table public.trips
  add column if not exists finished_at timestamptz;

alter table public.trips
  add column if not exists final_fare integer;

alter table public.trips
  add column if not exists wait_seconds integer;
