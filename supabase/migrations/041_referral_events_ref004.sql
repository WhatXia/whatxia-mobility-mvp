-- REF-004: ampliar auditoría de referidos (códigos inválidos + conversión).

alter table public.referral_events
  drop constraint if exists referral_events_event_type_check;

alter table public.referral_events
  add constraint referral_events_event_type_check
  check (
    event_type in (
      'link_opened',
      'link_shared',
      'passenger_registered',
      'invalid_code',
      'conversion'
    )
  );

comment on table public.referral_events is
  'Auditoría: link_opened, link_shared, passenger_registered, invalid_code, conversion.';
