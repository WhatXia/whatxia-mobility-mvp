-- Campos nuevos del formulario de registro de conductor
alter table public.drivers
  add column if not exists email text,
  add column if not exists operation_expires_at date;

comment on column public.drivers.email is
  'Correo electrónico del conductor';
comment on column public.drivers.operation_expires_at is
  'Fecha de vencimiento de la tarjeta de operación';
