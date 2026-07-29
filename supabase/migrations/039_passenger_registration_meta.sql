-- USER-001.1: fecha de registro + origen de marketing.

alter table public.passengers
  add column if not exists registered_at timestamptz;

update public.passengers
set registered_at = created_at
where registered_at is null;

alter table public.passengers
  alter column registered_at set default now();

alter table public.passengers
  alter column registered_at set not null;

alter table public.passengers
  add column if not exists registration_source text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'passengers_registration_source_check'
  ) then
    alter table public.passengers
      add constraint passengers_registration_source_check
      check (
        registration_source is null
        or registration_source in (
          'INSTAGRAM',
          'FACEBOOK',
          'TIKTOK',
          'REFERRAL',
          'QR',
          'ORGANIC',
          'OTHER'
        )
      );
  end if;
end $$;

create index if not exists passengers_registered_at_idx
  on public.passengers (registered_at desc);

create index if not exists passengers_registration_source_idx
  on public.passengers (registration_source);

comment on column public.passengers.registered_at is
  'Fecha/hora de registro del usuario (marketing y cohortes diarias).';

comment on column public.passengers.registration_source is
  'Origen de adquisición: Instagram, Facebook, TikTok, Referido, QR, Orgánico, Otro.';
