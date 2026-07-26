-- Autenticación de conductores (Fase 1): solo hash, nunca contraseña en texto plano.
alter table public.drivers
  add column if not exists password_hash text;

comment on column public.drivers.password_hash is
  'Hash scrypt de la contraseña del conductor. NULL = pendiente de configurar.';
