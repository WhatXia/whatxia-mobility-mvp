-- Nombre preferido del usuario (conversaciones).
-- whatsapp_name: referencia del perfil WA; preferred_name: elegido por el usuario.

alter table public.passengers
  add column if not exists preferred_name text;

alter table public.passengers
  add column if not exists whatsapp_name text;

-- Usuarios existentes: conservar name actual como preferido y como referencia WA.
update public.passengers
set whatsapp_name = coalesce(whatsapp_name, name)
where whatsapp_name is null;

update public.passengers
set preferred_name = coalesce(preferred_name, nullif(trim(name), ''))
where preferred_name is null;

comment on column public.passengers.preferred_name is
  'Nombre elegido por el usuario para las conversaciones WhatXia.';
comment on column public.passengers.whatsapp_name is
  'Nombre de perfil WhatsApp (referencia; puede incluir emojis/apodos).';
