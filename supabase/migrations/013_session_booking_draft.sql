-- Sprint 23: draft de cotización geográfica en sesión

alter table public.conversation_sessions
  add column if not exists booking_draft jsonb;
