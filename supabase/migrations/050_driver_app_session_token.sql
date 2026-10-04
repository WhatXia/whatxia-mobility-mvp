-- Token de sesión para whatxia-driver-v1.
-- Compatible con filas existentes: token_hash queda NULL y
-- whatsapp_authenticated queda true por el default, así el bot
-- sigue encontrando la sesión por teléfono.
-- El secreto en claro no se almacena; solo su SHA-256.

alter table public.driver_auth_sessions
  add column if not exists token_hash text,
  add column if not exists whatsapp_authenticated boolean not null default true;

create unique index if not exists driver_auth_sessions_token_hash_uidx
  on public.driver_auth_sessions (token_hash)
  where token_hash is not null;

comment on column public.driver_auth_sessions.token_hash is
  'SHA-256 hex del token de la app. NULL = sesión sin app. El token en claro se entrega una sola vez al activar.';

comment on column public.driver_auth_sessions.whatsapp_authenticated is
  'true si el conductor inició sesión en el bot. Activar la app no lo enciende.';
