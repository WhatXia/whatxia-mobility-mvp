-- Cancelación de viaje (cierra túnel de inmediato)

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
      'CANCELLED'
    )
  );
