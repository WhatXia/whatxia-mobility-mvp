-- Identidad WhatXia: full_name + preferred_name (+ whatsapp_name ya en 035).
-- full_name: identidad compartida P↔D. preferred_name: conversación.

alter table public.passengers
  add column if not exists full_name text;

-- Usuarios que ya tienen preferred_name (Sprint 2.2): completar full_name sin re-preguntar.
update public.passengers
set full_name = coalesce(
  nullif(trim(full_name), ''),
  nullif(trim(name), ''),
  nullif(trim(preferred_name), '')
)
where full_name is null
  and (
    nullif(trim(name), '') is not null
    or nullif(trim(preferred_name), '') is not null
  );

comment on column public.passengers.full_name is
  'Nombre y apellido exactos indicados por el usuario (sin separar automáticamente).';

-- Conductores: mismos campos de identidad (sin eliminar name legacy).
alter table public.drivers
  add column if not exists full_name text;

alter table public.drivers
  add column if not exists preferred_name text;

update public.drivers
set full_name = coalesce(nullif(trim(full_name), ''), nullif(trim(name), ''))
where full_name is null;

comment on column public.drivers.full_name is
  'Nombre y apellido para compartir identidad con el pasajero.';
comment on column public.drivers.preferred_name is
  'Nombre corto para conversaciones con el conductor.';
