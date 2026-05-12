-- VadeFantasy persistent watchlist
-- Run this once in Supabase SQL Editor after fantasy-vbf-schema.sql.
-- It is incremental: it does not drop or rewrite existing fantasy data.

create extension if not exists pgcrypto;

create or replace function public.fantasy_vbf_market_is_open(p_now timestamptz default now())
returns boolean
language sql
stable
as $$
  select extract(isodow from timezone('Europe/Madrid', coalesce(p_now, now())))::integer between 1 and 5
$$;

create table if not exists public.fantasy_vbf_watchlist (
  id uuid primary key default gen_random_uuid(),
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_slug text not null,
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (season, user_id, player_slug),
  check (char_length(trim(player_slug)) between 1 and 140),
  check (note is null or char_length(note) <= 280)
);

create index if not exists fantasy_vbf_watchlist_user_idx
  on public.fantasy_vbf_watchlist (user_id, season, created_at desc);

create index if not exists fantasy_vbf_watchlist_player_idx
  on public.fantasy_vbf_watchlist (season, player_slug, created_at desc);

do $$
begin
  create trigger fantasy_vbf_watchlist_touch_updated_at
  before update on public.fantasy_vbf_watchlist
  for each row execute function public.fantasy_vbf_touch_updated_at();
exception
  when duplicate_object then null;
end
$$;

alter table public.fantasy_vbf_watchlist enable row level security;

drop policy if exists fantasy_vbf_watchlist_select_own on public.fantasy_vbf_watchlist;
drop policy if exists fantasy_vbf_watchlist_insert_own on public.fantasy_vbf_watchlist;
drop policy if exists fantasy_vbf_watchlist_update_own on public.fantasy_vbf_watchlist;
drop policy if exists fantasy_vbf_watchlist_delete_own on public.fantasy_vbf_watchlist;

create policy fantasy_vbf_watchlist_select_own
  on public.fantasy_vbf_watchlist
  for select
  using (auth.uid() = user_id);

create policy fantasy_vbf_watchlist_insert_own
  on public.fantasy_vbf_watchlist
  for insert
  with check (auth.uid() = user_id);

create policy fantasy_vbf_watchlist_update_own
  on public.fantasy_vbf_watchlist
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy fantasy_vbf_watchlist_delete_own
  on public.fantasy_vbf_watchlist
  for delete
  using (auth.uid() = user_id);

revoke all on public.fantasy_vbf_watchlist from public;
grant select, insert, update, delete on public.fantasy_vbf_watchlist to authenticated;
grant execute on function public.fantasy_vbf_market_is_open(timestamptz) to anon, authenticated;

-- Jornada rule:
-- fantasy_vbf_market_is_open() returns true Monday-Friday in Europe/Madrid.
-- The market is closed from Saturday 00:00 until Monday 00:00.
-- The scoring roster should be frozen by calling:
--   select public.fantasy_vbf_capture_round_snapshot_for_date('OP15', (timezone('Europe/Madrid', now()))::date, false);
-- from a trusted scheduled job at Saturday 00:00 Europe/Madrid.
