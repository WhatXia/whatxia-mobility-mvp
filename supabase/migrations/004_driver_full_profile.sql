-- Sprint 16: perfil completo del conductor + preparación para gestión documental

alter table public.drivers
  add column if not exists document_id text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists vehicle_brand text,
  add column if not exists vehicle_model text,
  add column if not exists vehicle_color text,
  add column if not exists vehicle_year integer,
  add column if not exists soat_expires_at date,
  add column if not exists techno_expires_at date,
  add column if not exists license_expires_at date,
  -- Preparación Sprint 17+ (recordatorios / bloqueo / reactivación)
  add column if not exists documents_blocked boolean not null default false,
  add column if not exists documents_blocked_reason text,
  add column if not exists documents_reminder_sent_at timestamptz;

comment on column public.drivers.documents_blocked is
  'Prep Sprint 17+: bloqueo automático por documentos vencidos';
comment on column public.drivers.documents_reminder_sent_at is
  'Prep Sprint 17+: último recordatorio de vencimiento enviado';
