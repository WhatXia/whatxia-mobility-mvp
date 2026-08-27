-- MVP2 piloto: telemetría GPS OwnTracks (ingest HTTP).
-- Independiente de booking, dispatch, tarifas y taxímetro de prueba.
-- trip_id queda NULL en el piloto; la asociación a viajes es posterior.

create table if not exists public.driver_telemetry_devices (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers (id) on delete cascade,
  owntracks_user text not null,
  owntracks_device text not null,
  tid text,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  label text,
  last_seen_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  created_at timestamptz not null default now(),
  constraint driver_telemetry_devices_user_device_unique
    unique (owntracks_user, owntracks_device)
);

create index if not exists driver_telemetry_devices_driver_idx
  on public.driver_telemetry_devices (driver_id);

create index if not exists driver_telemetry_devices_tid_idx
  on public.driver_telemetry_devices (tid)
  where tid is not null;

comment on table public.driver_telemetry_devices is
  'MVP2: registro de dispositivos OwnTracks enrolados a un conductor. Alta manual/ops.';

comment on column public.driver_telemetry_devices.owntracks_user is
  'Username OwnTracks (segmento user de topic owntracks/<user>/<device>).';

comment on column public.driver_telemetry_devices.owntracks_device is
  'Device ID OwnTracks (segmento device de topic).';

comment on column public.driver_telemetry_devices.tid is
  'Tracker ID OwnTracks (2 caracteres). Índice auxiliar; no es identificador único.';

comment on column public.driver_telemetry_devices.status is
  'active = acepta ingest; revoked = rechazado aunque el secreto de flota sea válido.';

create table if not exists public.driver_location_points (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null
    references public.driver_telemetry_devices (id) on delete cascade,
  driver_id uuid not null references public.drivers (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null,
  latitude double precision not null,
  longitude double precision not null,
  recorded_at timestamptz not null,
  accuracy_m double precision,
  velocity_kmh double precision,
  bearing_deg double precision,
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  constraint driver_location_points_device_recorded_unique
    unique (device_id, recorded_at)
);

create index if not exists driver_location_points_driver_recorded_idx
  on public.driver_location_points (driver_id, recorded_at desc);

create index if not exists driver_location_points_trip_recorded_idx
  on public.driver_location_points (trip_id, recorded_at);

create index if not exists driver_location_points_recorded_idx
  on public.driver_location_points (recorded_at);

comment on table public.driver_location_points is
  'MVP2: serie append-only de puntos GPS OwnTracks. trip_id NULL en el piloto.';

comment on column public.driver_location_points.recorded_at is
  'Timestamp del dispositivo (OwnTracks tst, epoch → timestamptz UTC).';

comment on column public.driver_location_points.accuracy_m is
  'OwnTracks acc (metros).';

comment on column public.driver_location_points.velocity_kmh is
  'OwnTracks vel (km/h).';

comment on column public.driver_location_points.bearing_deg is
  'OwnTracks cog (course over ground, 0–360).';

comment on column public.driver_location_points.raw_payload is
  'JSON original del punto OwnTracks.';

comment on column public.driver_location_points.trip_id is
  'Reservado para asociación posterior a un viaje. El ingest del piloto no lo rellena.';

alter table public.driver_telemetry_devices enable row level security;
alter table public.driver_location_points enable row level security;

drop policy if exists driver_telemetry_devices_deny_all
  on public.driver_telemetry_devices;
create policy driver_telemetry_devices_deny_all
  on public.driver_telemetry_devices
  for all using (false) with check (false);

drop policy if exists driver_location_points_deny_all
  on public.driver_location_points;
create policy driver_location_points_deny_all
  on public.driver_location_points
  for all using (false) with check (false);
