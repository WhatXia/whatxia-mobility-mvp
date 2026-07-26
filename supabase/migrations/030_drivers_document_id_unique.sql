-- Cédula única (document_id = número de documento / document_number).
-- Impide registros duplicados aunque falle la validación de aplicación.
-- NULL permitido múltiples veces (conductores legacy sin cédula).

create unique index if not exists drivers_document_id_unique
  on public.drivers (document_id)
  where document_id is not null;

comment on column public.drivers.document_id is
  'Número de cédula / document_number del conductor (único cuando no es null)';
