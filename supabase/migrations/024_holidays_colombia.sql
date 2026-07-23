-- Festivos nacionales (SSoT calendario). El Tariff Engine solo lee esta tabla.
-- Carga inicial CO 2025–2027 generada con date-holidays (solo seed; no runtime).

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  holiday_date date not null,
  name text not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  constraint holidays_country_date_unique unique (country_code, holiday_date)
);

create index if not exists holidays_country_date_idx
  on public.holidays (country_code, holiday_date);

comment on table public.holidays is
  'Festivos oficiales por país. Usado por Tariff Engine; no depende de fare_rules.holiday_dates.';

comment on column public.fare_rules.holiday_dates is
  'DEPRECATED: no usar. Calendario en public.holidays por country_code.';

-- Vaciar lista embebida en reglas (ya no es fuente operativa).
update public.fare_rules
set
  holiday_dates = '[]'::jsonb,
  updated_at = now()
where holiday_dates is distinct from '[]'::jsonb;

insert into public.holidays (country_code, holiday_date, name, source)
values
  ('CO', '2025-01-01'::date, 'Año Nuevo', 'date-holidays'),
  ('CO', '2025-01-06'::date, 'Día de los Reyes Magos', 'date-holidays'),
  ('CO', '2025-03-24'::date, 'San José', 'date-holidays'),
  ('CO', '2025-04-17'::date, 'Jueves Santo', 'date-holidays'),
  ('CO', '2025-04-18'::date, 'Viernes Santo', 'date-holidays'),
  ('CO', '2025-04-20'::date, 'Pascua', 'date-holidays'),
  ('CO', '2025-05-01'::date, 'Día del Trabajador', 'date-holidays'),
  ('CO', '2025-06-02'::date, 'Ascensión del Señor', 'date-holidays'),
  ('CO', '2025-06-23'::date, 'Corpus Christi', 'date-holidays'),
  ('CO', '2025-06-30'::date, 'Sagrado Corazón / San Pedro y San Pablo', 'date-holidays'),
  ('CO', '2025-07-20'::date, 'Día de la Independencia', 'date-holidays'),
  ('CO', '2025-08-07'::date, 'Batalla de Boyacá', 'date-holidays'),
  ('CO', '2025-08-18'::date, 'Asunción de la Virgen', 'date-holidays'),
  ('CO', '2025-10-13'::date, 'Día de la Raza', 'date-holidays'),
  ('CO', '2025-11-03'::date, 'Todos los Santos', 'date-holidays'),
  ('CO', '2025-11-17'::date, 'Independencia de Cartagena', 'date-holidays'),
  ('CO', '2025-12-08'::date, 'Inmaculada Concepción', 'date-holidays'),
  ('CO', '2025-12-25'::date, 'Navidad', 'date-holidays'),
  ('CO', '2026-01-01'::date, 'Año Nuevo', 'date-holidays'),
  ('CO', '2026-01-12'::date, 'Día de los Reyes Magos', 'date-holidays'),
  ('CO', '2026-03-23'::date, 'San José', 'date-holidays'),
  ('CO', '2026-04-02'::date, 'Jueves Santo', 'date-holidays'),
  ('CO', '2026-04-03'::date, 'Viernes Santo', 'date-holidays'),
  ('CO', '2026-04-05'::date, 'Pascua', 'date-holidays'),
  ('CO', '2026-05-01'::date, 'Día del Trabajador', 'date-holidays'),
  ('CO', '2026-05-18'::date, 'Ascensión del Señor', 'date-holidays'),
  ('CO', '2026-06-08'::date, 'Corpus Christi', 'date-holidays'),
  ('CO', '2026-06-15'::date, 'Sagrado Corazón de Jesús', 'date-holidays'),
  ('CO', '2026-06-29'::date, 'San Pedro y San Pablo', 'date-holidays'),
  ('CO', '2026-07-13'::date, 'Virgen de Chiquinquirá', 'date-holidays'),
  ('CO', '2026-07-20'::date, 'Día de la Independencia', 'date-holidays'),
  ('CO', '2026-08-07'::date, 'Batalla de Boyacá', 'date-holidays'),
  ('CO', '2026-08-17'::date, 'Asunción de la Virgen', 'date-holidays'),
  ('CO', '2026-10-12'::date, 'Día de la Raza', 'date-holidays'),
  ('CO', '2026-11-02'::date, 'Todos los Santos', 'date-holidays'),
  ('CO', '2026-11-16'::date, 'Independencia de Cartagena', 'date-holidays'),
  ('CO', '2026-12-08'::date, 'Inmaculada Concepción', 'date-holidays'),
  ('CO', '2026-12-25'::date, 'Navidad', 'date-holidays'),
  ('CO', '2027-01-01'::date, 'Año Nuevo', 'date-holidays'),
  ('CO', '2027-01-11'::date, 'Día de los Reyes Magos', 'date-holidays'),
  ('CO', '2027-03-22'::date, 'San José', 'date-holidays'),
  ('CO', '2027-03-25'::date, 'Jueves Santo', 'date-holidays'),
  ('CO', '2027-03-26'::date, 'Viernes Santo', 'date-holidays'),
  ('CO', '2027-03-28'::date, 'Pascua', 'date-holidays'),
  ('CO', '2027-05-01'::date, 'Día del Trabajador', 'date-holidays'),
  ('CO', '2027-05-10'::date, 'Ascensión del Señor', 'date-holidays'),
  ('CO', '2027-05-31'::date, 'Corpus Christi', 'date-holidays'),
  ('CO', '2027-06-07'::date, 'Sagrado Corazón de Jesús', 'date-holidays'),
  ('CO', '2027-07-05'::date, 'San Pedro y San Pablo', 'date-holidays'),
  ('CO', '2027-07-12'::date, 'Virgen de Chiquinquirá', 'date-holidays'),
  ('CO', '2027-07-20'::date, 'Día de la Independencia', 'date-holidays'),
  ('CO', '2027-08-07'::date, 'Batalla de Boyacá', 'date-holidays'),
  ('CO', '2027-08-16'::date, 'Asunción de la Virgen', 'date-holidays'),
  ('CO', '2027-10-18'::date, 'Día de la Raza', 'date-holidays'),
  ('CO', '2027-11-01'::date, 'Todos los Santos', 'date-holidays'),
  ('CO', '2027-11-15'::date, 'Independencia de Cartagena', 'date-holidays'),
  ('CO', '2027-12-08'::date, 'Inmaculada Concepción', 'date-holidays'),
  ('CO', '2027-12-25'::date, 'Navidad', 'date-holidays')
on conflict (country_code, holiday_date) do update
set
  name = excluded.name,
  source = excluded.source;
