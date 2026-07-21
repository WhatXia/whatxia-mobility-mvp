-- Sprint 18 ajuste: estado closing del túnel conversacional

alter table public.conversation_tunnels
  drop constraint if exists conversation_tunnels_status_check;

alter table public.conversation_tunnels
  add constraint conversation_tunnels_status_check
  check (status in ('active', 'closing', 'closed'));

drop index if exists conversation_tunnels_closes_at_idx;

create index if not exists conversation_tunnels_closes_at_idx
  on public.conversation_tunnels (closes_at)
  where status = 'closing' and closes_at is not null;
