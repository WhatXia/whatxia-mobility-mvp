-- Sprint 21: búsqueda inteligente y reasignación

alter table public.trips
  add column if not exists search_deadline_at timestamptz;

alter table public.trips
  add column if not exists continue_deadline_at timestamptz;

alter table public.trips
  add column if not exists search_awaiting_continue boolean not null default false;

create index if not exists trips_search_deadline_idx
  on public.trips (search_deadline_at)
  where status = 'SEARCHING' and search_awaiting_continue = false;

create index if not exists trips_continue_deadline_idx
  on public.trips (continue_deadline_at)
  where status = 'SEARCHING' and search_awaiting_continue = true;
