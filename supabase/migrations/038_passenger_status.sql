-- USER-001: estado de acceso del pasajero (pre-lanzamiento / pioneros).
-- Existentes → ACTIVE. Nuevos: el app asigna PIONEER o ACTIVE según PRE_LAUNCH_MODE.

alter table public.passengers
  add column if not exists status text;

update public.passengers
set status = 'ACTIVE'
where status is null;

alter table public.passengers
  alter column status set default 'ACTIVE';

alter table public.passengers
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'passengers_status_check'
  ) then
    alter table public.passengers
      add constraint passengers_status_check
      check (status in ('PIONEER', 'BETA', 'ACTIVE', 'BLOCKED'));
  end if;
end $$;

create index if not exists passengers_status_idx
  on public.passengers (status);

comment on column public.passengers.status is
  'Acceso: PIONEER (lista de espera), BETA (pruebas), ACTIVE, BLOCKED.';
