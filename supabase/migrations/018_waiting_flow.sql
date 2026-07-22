-- Sprint 27: WaitingFlow — cancelled_no_driver + contador de recordatorios

alter table public.trips
  drop constraint if exists trips_status_check;

alter table public.trips
  add constraint trips_status_check
  check (
    status in (
      'SEARCHING',
      'ASSIGNED',
      'ETA_INFORMED',
      'DRIVER_ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'cancelled_no_driver'
    )
  );

alter table public.trips
  add column if not exists search_reminder_count integer not null default 0;

comment on column public.trips.search_reminder_count is
  'WaitingFlow: 0=antes del 1er recordatorio, 1=tras 1er continuar, 2=ventana final (auto-cancel)';
