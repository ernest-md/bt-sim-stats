create extension if not exists pgcrypto;

drop table if exists public.fantasy_vbf_notifications cascade;
drop table if exists public.fantasy_vbf_bid_offers cascade;
drop table if exists public.fantasy_vbf_player_rounds cascade;
drop table if exists public.fantasy_vbf_player_pool cascade;
drop table if exists public.fantasy_vbf_team_rounds cascade;
drop table if exists public.fantasy_vbf_rounds cascade;
drop table if exists public.fantasy_vbf_transactions cascade;
drop table if exists public.fantasy_vbf_roster_snapshots cascade;
drop table if exists public.fantasy_vbf_roster_players cascade;
drop table if exists public.fantasy_vbf_members cascade;
drop table if exists public.fantasy_vbf_leagues cascade;
drop table if exists public.fantasy_vbf_teams cascade;
drop table if exists public.fantasy_vbf_seasons cascade;

drop function if exists public.fantasy_vbf_mark_notifications_read(jsonb);
drop function if exists public.fantasy_vbf_rename_team(text, text);
drop function if exists public.fantasy_vbf_sync_round(text, text, text, integer, jsonb);
drop function if exists public.fantasy_vbf_start_week(text, text, text, integer);
drop function if exists public.fantasy_vbf_save_lineup(text, jsonb, text);
drop function if exists public.fantasy_vbf_sell_player(text, text, text, integer);
drop function if exists public.fantasy_vbf_sell_player(text, text, text);
drop function if exists public.fantasy_vbf_buy_player(text, text, text, text, uuid);
drop function if exists public.fantasy_vbf_buy_player(text, text, text, text, text, integer, integer, integer);
drop function if exists public.fantasy_vbf_buy_player(text, text, text, text, integer, integer);
drop function if exists public.fantasy_vbf_buy_player(text, text, text, text, integer);
drop function if exists public.fantasy_vbf_create_team(text, text, jsonb);
drop function if exists public.fantasy_vbf_create_team(text, text);
drop function if exists public.fantasy_vbf_capture_round_snapshot_for_date(text, date, boolean);
drop function if exists public.fantasy_vbf_capture_round_snapshot(text, text, text, integer, boolean);
drop function if exists public.fantasy_vbf_sync_player_pool(text, text, text, integer, jsonb);
drop function if exists public.fantasy_vbf_market_is_open(timestamptz);
drop function if exists public.fantasy_vbf_price_bucket(integer);
drop function if exists public.fantasy_vbf_default_clause(integer, numeric);
drop function if exists public.fantasy_vbf_jsonb_array_to_text_array(jsonb);
drop function if exists public.fantasy_vbf_touch_updated_at() cascade;

create or replace function public.fantasy_vbf_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.fantasy_vbf_jsonb_array_to_text_array(p_value jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(trim(item)), array[]::text[])
  from jsonb_array_elements_text(coalesce(p_value, '[]'::jsonb)) as item
  where trim(item) <> ''
$$;

create or replace function public.fantasy_vbf_market_is_open(p_now timestamptz default now())
returns boolean
language sql
stable
as $$
  select extract(isodow from timezone('Europe/Madrid', coalesce(p_now, now())))::integer not in (6, 7)
$$;

create or replace function public.fantasy_vbf_price_bucket(p_round_rank integer)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_round_rank, 999999) <= 1 then 50000
    when coalesce(p_round_rank, 999999) <= 4 then 40000
    when coalesce(p_round_rank, 999999) <= 8 then 30000
    when coalesce(p_round_rank, 999999) <= 16 then 20000
    else 10000
  end
$$;

create or replace function public.fantasy_vbf_default_clause(p_price integer, p_multiplier numeric)
returns integer
language sql
immutable
as $$
  select greatest(
    coalesce(p_price, 0),
    ceil(greatest(coalesce(p_price, 0), 1) * greatest(coalesce(p_multiplier, 1.5), 1.1))::integer
  )
$$;

create table public.fantasy_vbf_seasons (
  season text primary key,
  label text not null,
  budget integer not null default 150000 check (budget > 0),
  squad_size integer not null default 3 check (squad_size between 1 and 6),
  starter_size integer not null default 3 check (starter_size between 1 and 6),
  starter_pack_size integer not null default 3 check (starter_pack_size between 1 and 6),
  max_player_copies integer not null default 3 check (max_player_copies between 1 and 12),
  max_weekly_transfers integer not null default 999 check (max_weekly_transfers between 0 and 9999),
  max_weekly_captain_changes integer not null default 1 check (max_weekly_captain_changes between 0 and 10),
  weekly_base_reward integer not null default 20000 check (weekly_base_reward >= 0),
  max_savings integer not null default 2147483647 check (max_savings >= 0),
  captain_multiplier numeric(4,2) not null default 1.5 check (captain_multiplier >= 1),
  clause_multiplier numeric(4,2) not null default 1.5 check (clause_multiplier >= 1.1),
  is_open boolean not null default true,
  current_round_key text,
  current_round_label text,
  current_round_order integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.fantasy_vbf_player_pool (
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  player_slug text not null,
  player_name text not null,
  player_tier text not null default '',
  player_rank integer not null default 9999,
  round_rank integer not null default 9999,
  current_price integer not null default 0 check (current_price >= 0),
  default_clause integer not null default 0 check (default_clause >= 0),
  total_points numeric(12,2) not null default 0,
  avg_fantasy_points numeric(12,2) not null default 0,
  played integer not null default 0 check (played >= 0),
  wins integer not null default 0 check (wins >= 0),
  current_fantasy_points numeric(12,2) not null default 0,
  current_raw_points integer not null default 0,
  current_round_key text,
  current_round_label text,
  current_won boolean not null default false,
  current_streak integer not null default 0 check (current_streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (season, player_slug)
);

create table public.fantasy_vbf_player_rounds (
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  player_slug text not null,
  round_key text not null,
  round_label text not null,
  round_order integer not null default 0,
  raw_points integer,
  fantasy_points numeric(12,2),
  won boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (season, player_slug, round_key)
);

create table public.fantasy_vbf_teams (
  id uuid primary key default gen_random_uuid(),
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team_name text not null,
  coins integer not null,
  captain_player_slug text,
  total_points numeric(12,2) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (season, user_id),
  check (char_length(trim(team_name)) between 3 and 60),
  check (coins >= 0)
);

create table public.fantasy_vbf_roster_players (
  id uuid primary key default gen_random_uuid(),
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  team_id uuid not null references public.fantasy_vbf_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_slug text not null,
  player_name text not null,
  player_tier text not null default '',
  player_rank integer not null default 9999,
  buy_price integer not null default 0 check (buy_price >= 0),
  clause_price integer not null check (clause_price >= 0),
  acquisition_type text not null default 'market' check (acquisition_type in ('starter', 'market', 'buyout')),
  acquired_round_key text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (season, team_id, player_slug)
);

create table public.fantasy_vbf_roster_snapshots (
  id uuid primary key default gen_random_uuid(),
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  round_key text not null,
  round_label text not null,
  round_order integer not null default 0,
  team_id uuid not null references public.fantasy_vbf_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_slug text not null,
  player_name text not null,
  player_tier text not null default '',
  player_rank integer not null default 9999,
  buy_price integer not null default 0 check (buy_price >= 0),
  clause_price integer not null default 0 check (clause_price >= 0),
  captured_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (season, round_key, team_id, player_slug)
);

create table public.fantasy_vbf_transactions (
  id uuid primary key default gen_random_uuid(),
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  round_key text,
  team_id uuid not null references public.fantasy_vbf_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_slug text,
  player_name text,
  tx_type text not null check (tx_type in ('starter', 'buy', 'release', 'clause_in', 'clause_out', 'system_reward')),
  amount integer not null check (amount >= 0),
  counts_as_transfer boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.fantasy_vbf_notifications (
  id uuid primary key default gen_random_uuid(),
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid references public.fantasy_vbf_teams(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.fantasy_vbf_bid_offers (
  id uuid primary key default gen_random_uuid(),
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  buyer_team_id uuid not null references public.fantasy_vbf_teams(id) on delete cascade,
  buyer_user_id uuid not null references auth.users(id) on delete cascade,
  seller_team_id uuid references public.fantasy_vbf_teams(id) on delete cascade,
  seller_user_id uuid references auth.users(id) on delete cascade,
  player_slug text not null,
  player_name text not null,
  amount integer not null check (amount >= 0),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected', 'cancelled', 'expired')),
  created_at timestamptz not null default timezone('utc', now()),
  responded_at timestamptz
);

create table public.fantasy_vbf_rounds (
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  round_key text not null,
  round_label text not null,
  round_order integer not null,
  rewards_applied boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (season, round_key)
);

create table public.fantasy_vbf_team_rounds (
  id uuid primary key default gen_random_uuid(),
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  team_id uuid not null references public.fantasy_vbf_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  round_key text not null,
  round_label text not null,
  round_order integer not null,
  weekly_points numeric(12,2) not null default 0,
  weekly_rank integer,
  reward_coins integer not null default 0,
  transfers_used integer not null default 0,
  captain_changes_used integer not null default 0,
  synced_at timestamptz not null default timezone('utc', now()),
  unique (season, team_id, round_key)
);

create index fantasy_vbf_teams_season_idx on public.fantasy_vbf_teams (season, created_at desc);
create index fantasy_vbf_player_pool_season_idx on public.fantasy_vbf_player_pool (season, player_rank, round_rank, current_price desc);
create index fantasy_vbf_player_rounds_round_idx on public.fantasy_vbf_player_rounds (season, round_key, round_order, fantasy_points desc nulls last);
create index fantasy_vbf_roster_team_idx on public.fantasy_vbf_roster_players (team_id, created_at desc);
create index fantasy_vbf_roster_slug_idx on public.fantasy_vbf_roster_players (season, player_slug, clause_price, created_at);
create index fantasy_vbf_roster_snapshots_team_idx on public.fantasy_vbf_roster_snapshots (season, round_key, team_id, captured_at desc);
create index fantasy_vbf_roster_snapshots_slug_idx on public.fantasy_vbf_roster_snapshots (season, player_slug, round_key, captured_at desc);
create index fantasy_vbf_team_rounds_round_idx on public.fantasy_vbf_team_rounds (season, round_key, weekly_rank);
create index fantasy_vbf_notifications_user_idx on public.fantasy_vbf_notifications (user_id, created_at desc);
create index fantasy_vbf_transactions_round_idx on public.fantasy_vbf_transactions (season, round_key, created_at desc);
create index fantasy_vbf_bid_offers_buyer_idx on public.fantasy_vbf_bid_offers (buyer_user_id, created_at desc);
create index fantasy_vbf_bid_offers_player_idx on public.fantasy_vbf_bid_offers (season, player_slug, status, created_at desc);

create trigger fantasy_vbf_seasons_touch_updated_at before update on public.fantasy_vbf_seasons for each row execute function public.fantasy_vbf_touch_updated_at();
create trigger fantasy_vbf_player_pool_touch_updated_at before update on public.fantasy_vbf_player_pool for each row execute function public.fantasy_vbf_touch_updated_at();
create trigger fantasy_vbf_player_rounds_touch_updated_at before update on public.fantasy_vbf_player_rounds for each row execute function public.fantasy_vbf_touch_updated_at();
create trigger fantasy_vbf_teams_touch_updated_at before update on public.fantasy_vbf_teams for each row execute function public.fantasy_vbf_touch_updated_at();
create trigger fantasy_vbf_rounds_touch_updated_at before update on public.fantasy_vbf_rounds for each row execute function public.fantasy_vbf_touch_updated_at();

insert into public.fantasy_vbf_seasons (
  season, label, budget, squad_size, starter_size, starter_pack_size,
  max_player_copies, max_weekly_transfers, max_weekly_captain_changes,
  weekly_base_reward, max_savings, captain_multiplier, clause_multiplier, is_open
)
values ('OP15', 'Fantasy OP15', 150000, 3, 3, 3, 3, 999, 1, 20000, 2147483647, 1.5, 1.5, true);

alter table public.fantasy_vbf_seasons enable row level security;
alter table public.fantasy_vbf_player_pool enable row level security;
alter table public.fantasy_vbf_player_rounds enable row level security;
alter table public.fantasy_vbf_teams enable row level security;
alter table public.fantasy_vbf_roster_players enable row level security;
alter table public.fantasy_vbf_roster_snapshots enable row level security;
alter table public.fantasy_vbf_transactions enable row level security;
alter table public.fantasy_vbf_notifications enable row level security;
alter table public.fantasy_vbf_bid_offers enable row level security;
alter table public.fantasy_vbf_rounds enable row level security;
alter table public.fantasy_vbf_team_rounds enable row level security;

create policy fantasy_vbf_seasons_select_all on public.fantasy_vbf_seasons for select using (true);
create policy fantasy_vbf_player_pool_select_all on public.fantasy_vbf_player_pool for select using (true);
create policy fantasy_vbf_player_rounds_select_all on public.fantasy_vbf_player_rounds for select using (true);
create policy fantasy_vbf_teams_select_all on public.fantasy_vbf_teams for select using (true);
create policy fantasy_vbf_roster_select_all on public.fantasy_vbf_roster_players for select using (true);
create policy fantasy_vbf_roster_snapshots_select_all on public.fantasy_vbf_roster_snapshots for select using (true);
create policy fantasy_vbf_transactions_select_all on public.fantasy_vbf_transactions for select using (true);
create policy fantasy_vbf_rounds_select_all on public.fantasy_vbf_rounds for select using (true);
create policy fantasy_vbf_team_rounds_select_all on public.fantasy_vbf_team_rounds for select using (true);
create policy fantasy_vbf_notifications_select_own on public.fantasy_vbf_notifications for select using (auth.uid() = user_id);
create policy fantasy_vbf_notifications_update_own on public.fantasy_vbf_notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy fantasy_vbf_bid_offers_select_all on public.fantasy_vbf_bid_offers for select using (true);

revoke all on public.fantasy_vbf_seasons from public;
revoke all on public.fantasy_vbf_player_pool from public;
revoke all on public.fantasy_vbf_player_rounds from public;
revoke all on public.fantasy_vbf_teams from public;
revoke all on public.fantasy_vbf_roster_players from public;
revoke all on public.fantasy_vbf_roster_snapshots from public;
revoke all on public.fantasy_vbf_transactions from public;
revoke all on public.fantasy_vbf_notifications from public;
revoke all on public.fantasy_vbf_bid_offers from public;
revoke all on public.fantasy_vbf_rounds from public;
revoke all on public.fantasy_vbf_team_rounds from public;

grant select on public.fantasy_vbf_seasons to anon, authenticated;
grant select on public.fantasy_vbf_player_pool to anon, authenticated;
grant select on public.fantasy_vbf_player_rounds to anon, authenticated;
grant select on public.fantasy_vbf_teams to anon, authenticated;
grant select on public.fantasy_vbf_roster_players to anon, authenticated;
grant select on public.fantasy_vbf_roster_snapshots to anon, authenticated;
grant select on public.fantasy_vbf_transactions to anon, authenticated;
grant select on public.fantasy_vbf_rounds to anon, authenticated;
grant select on public.fantasy_vbf_team_rounds to anon, authenticated;
grant select, update on public.fantasy_vbf_notifications to authenticated;
grant select on public.fantasy_vbf_bid_offers to anon, authenticated;

create or replace function public.fantasy_vbf_sync_player_pool(
  p_season text,
  p_round_key text,
  p_round_label text,
  p_round_order integer,
  p_players jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := upper(trim(coalesce(p_season, '')));
  v_round_key text := nullif(trim(coalesce(p_round_key, '')), '');
  v_round_label text := coalesce(nullif(trim(coalesce(p_round_label, '')), ''), v_round_key);
  v_cfg public.fantasy_vbf_seasons%rowtype;
begin
  if v_user is null then raise exception 'Debes iniciar sesion para sincronizar el pool fantasy.'; end if;
  if jsonb_typeof(coalesce(p_players, '[]'::jsonb)) <> 'array' then raise exception 'El pool debe llegar como array JSON.'; end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;

  create temporary table fantasy_vbf_tmp_pool (
    player_slug text primary key,
    player_name text not null,
    player_tier text not null,
    player_rank integer not null,
    round_rank integer not null,
    current_price integer not null,
    default_clause integer not null,
    total_points numeric(12,2) not null,
    avg_fantasy_points numeric(12,2) not null,
    played integer not null,
    wins integer not null,
    current_fantasy_points numeric(12,2) not null,
    current_raw_points integer not null,
    current_won boolean not null,
    current_streak integer not null,
    best_streak integer not null
  ) on commit drop;

  insert into fantasy_vbf_tmp_pool (
    player_slug, player_name, player_tier, player_rank, round_rank, current_price,
    default_clause, total_points, avg_fantasy_points, played, wins, current_fantasy_points, current_raw_points,
    current_won, current_streak, best_streak
  )
  select distinct on (player_slug)
    player_slug,
    player_name,
    player_tier,
    player_rank,
    round_rank,
    current_price,
    default_clause,
    total_points,
    avg_fantasy_points,
    played,
    wins,
    current_fantasy_points,
    current_raw_points,
    current_won,
    current_streak,
    best_streak
  from (
    select
      trim(coalesce(item->>'player_slug', '')) as player_slug,
      trim(coalesce(item->>'player_name', item->>'name', item->>'player_slug', '')) as player_name,
      trim(coalesce(item->>'player_tier', item->>'tier', '')) as player_tier,
      greatest(coalesce((item->>'player_rank')::integer, (item->>'rank')::integer, 9999), 1) as player_rank,
      greatest(coalesce((item->>'round_rank')::integer, 9999), 1) as round_rank,
      greatest(coalesce(nullif(item->>'current_price', '')::integer, 0), 0) as current_price,
      greatest(coalesce(nullif(item->>'default_clause', '')::integer, 0), 0) as default_clause,
      greatest(coalesce((item->>'total_points')::numeric, 0), 0) as total_points,
      coalesce((item->>'avg_fantasy_points')::numeric, 0) as avg_fantasy_points,
      greatest(coalesce((item->>'played')::integer, 0), 0) as played,
      greatest(coalesce((item->>'wins')::integer, 0), 0) as wins,
      coalesce((item->>'current_fantasy_points')::numeric, 0) as current_fantasy_points,
      greatest(coalesce((item->>'current_raw_points')::integer, 0), 0) as current_raw_points,
      coalesce((item->>'current_won')::boolean, false) as current_won,
      greatest(coalesce((item->>'current_streak')::integer, 0), 0) as current_streak,
      greatest(coalesce((item->>'best_streak')::integer, 0), 0) as best_streak
    from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) as item
    where trim(coalesce(item->>'player_slug', '')) <> ''
  ) src
  order by player_slug, player_rank asc, round_rank asc;

  insert into public.fantasy_vbf_player_pool (
    season, player_slug, player_name, player_tier, player_rank, round_rank,
    current_price, default_clause, total_points, avg_fantasy_points, played, wins,
    current_fantasy_points, current_raw_points, current_round_key, current_round_label,
    current_won, current_streak, best_streak
  )
  select
    v_season,
    tmp.player_slug,
    tmp.player_name,
    tmp.player_tier,
    tmp.player_rank,
    tmp.round_rank,
    case
      when tmp.current_price > 0 then tmp.current_price
      when lower(trim(tmp.player_tier)) = 'pirate king' then 100000
      when lower(trim(tmp.player_tier)) = 'yonkou' then 80000
      when lower(trim(tmp.player_tier)) = 'shichibukai' then 60000
      when lower(trim(tmp.player_tier)) = 'supernova' then 40000
      else 20000
    end,
    case
      when tmp.default_clause > 0 then tmp.default_clause
      else public.fantasy_vbf_default_clause(
        case
          when tmp.current_price > 0 then tmp.current_price
          when lower(trim(tmp.player_tier)) = 'pirate king' then 100000
          when lower(trim(tmp.player_tier)) = 'yonkou' then 80000
          when lower(trim(tmp.player_tier)) = 'shichibukai' then 60000
          when lower(trim(tmp.player_tier)) = 'supernova' then 40000
          else 20000
        end,
        v_cfg.clause_multiplier
      )
    end,
    tmp.total_points,
    tmp.avg_fantasy_points,
    tmp.played,
    tmp.wins,
    tmp.current_fantasy_points,
    tmp.current_raw_points,
    v_round_key,
    v_round_label,
    tmp.current_won,
    tmp.current_streak,
    tmp.best_streak
  from fantasy_vbf_tmp_pool tmp
  on conflict (season, player_slug) do update
    set player_name = excluded.player_name,
        player_tier = excluded.player_tier,
        player_rank = excluded.player_rank,
        round_rank = excluded.round_rank,
        current_price = excluded.current_price,
        default_clause = excluded.default_clause,
        total_points = excluded.total_points,
        avg_fantasy_points = excluded.avg_fantasy_points,
        played = excluded.played,
        wins = excluded.wins,
        current_fantasy_points = excluded.current_fantasy_points,
        current_raw_points = excluded.current_raw_points,
        current_round_key = excluded.current_round_key,
        current_round_label = excluded.current_round_label,
        current_won = excluded.current_won,
        current_streak = excluded.current_streak,
        best_streak = excluded.best_streak,
        updated_at = timezone('utc', now());

  create temporary table fantasy_vbf_tmp_rounds (
    player_slug text not null,
    round_key text not null,
    round_label text not null,
    round_order integer not null,
    raw_points integer,
    fantasy_points numeric(12,2),
    won boolean not null
  ) on commit drop;

  insert into fantasy_vbf_tmp_rounds (player_slug, round_key, round_label, round_order, raw_points, fantasy_points, won)
  select distinct on (player_slug, round_key)
    player_slug,
    round_key,
    round_label,
    round_order,
    raw_points,
    fantasy_points,
    won
  from (
    select
      trim(coalesce(item->>'player_slug', '')) as player_slug,
      trim(coalesce(hist->>'round_key', '')) as round_key,
      coalesce(nullif(trim(coalesce(hist->>'round_label', '')), ''), trim(coalesce(hist->>'round_key', ''))) as round_label,
      greatest(coalesce((hist->>'round_order')::integer, 0), 0) as round_order,
      case when trim(coalesce(hist->>'raw_points', '')) = '' then null else (hist->>'raw_points')::integer end as raw_points,
      case when trim(coalesce(hist->>'fantasy_points', '')) = '' then null else (hist->>'fantasy_points')::numeric end as fantasy_points,
      coalesce((hist->>'won')::boolean, false) as won
    from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) as item
    cross join lateral jsonb_array_elements(coalesce(item->'history', '[]'::jsonb)) as hist
    where trim(coalesce(item->>'player_slug', '')) <> ''
      and trim(coalesce(hist->>'round_key', '')) <> ''
  ) src
  order by player_slug, round_key, round_order desc;

  insert into public.fantasy_vbf_player_rounds (
    season, player_slug, round_key, round_label, round_order, raw_points, fantasy_points, won
  )
  select
    v_season,
    tmp.player_slug,
    tmp.round_key,
    tmp.round_label,
    tmp.round_order,
    tmp.raw_points,
    tmp.fantasy_points,
    tmp.won
  from fantasy_vbf_tmp_rounds tmp
  on conflict (season, player_slug, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        raw_points = excluded.raw_points,
        fantasy_points = excluded.fantasy_points,
        won = excluded.won,
        updated_at = timezone('utc', now());

  update public.fantasy_vbf_roster_players rp
  set player_name = pp.player_name,
      player_tier = pp.player_tier,
      player_rank = pp.player_rank,
      clause_price = pp.default_clause
  from public.fantasy_vbf_player_pool pp
  where rp.season = v_season
    and pp.season = rp.season
    and pp.player_slug = rp.player_slug;

  return jsonb_build_object(
    'season', v_season,
    'round_key', v_round_key,
    'synced_players', (select count(*) from fantasy_vbf_tmp_pool)
  );
end;
$$;

create or replace function public.fantasy_vbf_create_team(
  p_season text,
  p_team_name text,
  p_initial_roster jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := upper(trim(coalesce(p_season, '')));
  v_name text := trim(coalesce(p_team_name, ''));
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_team_id uuid;
  v_selected text[] := array[]::text[];
  v_pick public.fantasy_vbf_player_pool%rowtype;
  v_idx integer;
  v_inserted integer := 0;
begin
  if v_user is null then raise exception 'Debes iniciar sesion para crear tu equipo.'; end if;
  if char_length(v_name) < 3 then raise exception 'El nombre del equipo es demasiado corto.'; end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if v_cfg.is_open is not true then raise exception 'La temporada no esta abierta.'; end if;

  select id into v_team_id
  from public.fantasy_vbf_teams
  where season = v_season and user_id = v_user;

  if found then return v_team_id; end if;

  if not exists (select 1 from public.fantasy_vbf_player_pool where season = v_season) then
    raise exception 'Primero hay que sincronizar el pool de jugadores desde VBF.';
  end if;

  insert into public.fantasy_vbf_teams (season, user_id, team_name, coins)
  values (v_season, v_user, v_name, v_cfg.budget)
  returning id into v_team_id;

  for v_idx in 1..v_cfg.starter_pack_size loop
    select pp.*
    into v_pick
    from public.fantasy_vbf_player_pool pp
    left join (
      select player_slug, count(*) as copies_used
      from public.fantasy_vbf_roster_players
      where season = v_season
      group by player_slug
    ) used on used.player_slug = pp.player_slug
    where pp.season = v_season
      and lower(trim(pp.player_tier)) not in ('pirate king', 'yonkou')
      and coalesce(used.copies_used, 0) < v_cfg.max_player_copies
      and not (pp.player_slug = any(v_selected))
    order by random()
    limit 1;

    if not found then
      raise exception 'No pude completar el starter pack sin Pirate King ni Yonkou con los cupos disponibles.';
    end if;

    insert into public.fantasy_vbf_roster_players (
      season, team_id, user_id, player_slug, player_name, player_tier, player_rank,
      buy_price, clause_price, acquisition_type, acquired_round_key
    )
    values (
      v_season,
      v_team_id,
      v_user,
      v_pick.player_slug,
      v_pick.player_name,
      v_pick.player_tier,
      v_pick.player_rank,
      v_pick.current_price,
      v_pick.default_clause,
      'starter',
      v_cfg.current_round_key
    );

    insert into public.fantasy_vbf_transactions (
      season, round_key, team_id, user_id, player_slug, player_name, tx_type, amount, counts_as_transfer
    )
    values (
      v_season, v_cfg.current_round_key, v_team_id, v_user,
      v_pick.player_slug, v_pick.player_name, 'starter', 0, false
    );

    v_selected := array_append(v_selected, v_pick.player_slug);
    v_inserted := v_inserted + 1;
  end loop;

  if v_inserted <> v_cfg.starter_pack_size then
    raise exception 'No pude asignar el starter pack completo.';
  end if;

  update public.fantasy_vbf_teams
  set captain_player_slug = v_selected[1]
  where id = v_team_id
    and coalesce(captain_player_slug, '') = ''
    and array_length(v_selected, 1) > 0;

  if v_cfg.current_round_key is not null then
    insert into public.fantasy_vbf_team_rounds (
      season, team_id, user_id, round_key, round_label, round_order,
      weekly_points, weekly_rank, reward_coins, transfers_used, captain_changes_used
    )
    values (
      v_season,
      v_team_id,
      v_user,
      v_cfg.current_round_key,
      coalesce(nullif(v_cfg.current_round_label, ''), v_cfg.current_round_key),
      coalesce(v_cfg.current_round_order, 0),
      0, null, 0, 0, 0
    )
    on conflict (season, team_id, round_key) do nothing;
  end if;

  insert into public.fantasy_vbf_notifications (season, user_id, team_id, kind, title, body, payload)
  values (
    v_season,
    v_user,
    v_team_id,
    'starter_pack',
    'Starter pack repartido',
    format('Ya tienes tus %s jugadores iniciales y %s berries para arrancar.', v_cfg.starter_pack_size, v_cfg.budget),
    jsonb_build_object('team_id', v_team_id, 'starter_pack_size', v_cfg.starter_pack_size, 'players', v_selected)
  );

  return v_team_id;
end;
$$;

create or replace function public.fantasy_vbf_buy_player(
  p_season text,
  p_round_key text,
  p_player_slug text,
  p_outgoing_player_slug text default null,
  p_target_team_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := upper(trim(coalesce(p_season, '')));
  v_round_key text := nullif(trim(coalesce(p_round_key, '')), '');
  v_slug text := trim(coalesce(p_player_slug, ''));
  v_outgoing_slug text := nullif(trim(coalesce(p_outgoing_player_slug, '')), '');
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_team public.fantasy_vbf_teams%rowtype;
  v_pool public.fantasy_vbf_player_pool%rowtype;
  v_outgoing public.fantasy_vbf_roster_players%rowtype;
  v_target public.fantasy_vbf_roster_players%rowtype;
  v_round public.fantasy_vbf_team_rounds%rowtype;
  v_roster_count integer := 0;
  v_copy_count integer := 0;
  v_buy_cost integer := 0;
begin
  if v_user is null then raise exception 'Debes iniciar sesion para fichar.'; end if;
  if v_slug = '' then raise exception 'Jugador invalido.'; end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if v_cfg.is_open is not true then raise exception 'El mercado fantasy esta cerrado.'; end if;
  if public.fantasy_vbf_market_is_open(now()) is not true then
    raise exception 'El mercado esta cerrado entre sabado 00:00 y lunes 00:00.';
  end if;

  select * into v_team
  from public.fantasy_vbf_teams
  where season = v_season and user_id = v_user
  for update;

  if not found then raise exception 'Primero debes crear tu equipo.'; end if;

  select * into v_pool
  from public.fantasy_vbf_player_pool
  where season = v_season and player_slug = v_slug
  for update;

  if not found then raise exception 'No encontre ese jugador en el pool fantasy.'; end if;

  if exists (
    select 1
    from public.fantasy_vbf_roster_players
    where team_id = v_team.id and player_slug = v_slug
  ) then
    raise exception 'Ya tienes este jugador en tu plantilla.';
  end if;

  select count(*) into v_roster_count
  from public.fantasy_vbf_roster_players
  where team_id = v_team.id;

  if v_roster_count >= v_cfg.squad_size then
    if v_outgoing_slug is null then
      raise exception 'Debes elegir que jugador de tu plantilla sale del equipo.';
    end if;

    select * into v_outgoing
    from public.fantasy_vbf_roster_players
    where team_id = v_team.id and player_slug = v_outgoing_slug
    for update;

    if not found then raise exception 'El jugador que quieres sustituir no esta en tu plantilla.'; end if;
    if v_outgoing.player_slug = v_slug then raise exception 'No puedes sustituir un jugador por si mismo.'; end if;
  end if;

  if v_round_key is not null then
    insert into public.fantasy_vbf_team_rounds (
      season, team_id, user_id, round_key, round_label, round_order,
      weekly_points, weekly_rank, reward_coins, transfers_used, captain_changes_used
    )
    values (
      v_season,
      v_team.id,
      v_user,
      v_round_key,
      coalesce(nullif(v_cfg.current_round_label, ''), v_round_key),
      coalesce(v_cfg.current_round_order, 0),
      0, null, 0, 0, 0
    )
    on conflict (season, team_id, round_key) do nothing;

    select * into v_round
    from public.fantasy_vbf_team_rounds
    where season = v_season and team_id = v_team.id and round_key = v_round_key
    for update;
  end if;

  select count(*) into v_copy_count
  from public.fantasy_vbf_roster_players
  where season = v_season and player_slug = v_slug;

  if v_copy_count < v_cfg.max_player_copies then
    v_buy_cost := greatest(v_pool.current_price, 0);
    if v_team.coins < v_buy_cost then raise exception 'No tienes berries suficientes.'; end if;

    if v_outgoing.id is not null then
      delete from public.fantasy_vbf_roster_players where id = v_outgoing.id;

      insert into public.fantasy_vbf_transactions (
        season, round_key, team_id, user_id, player_slug, player_name, tx_type, amount, counts_as_transfer
      )
      values (
        v_season, v_round_key, v_team.id, v_user,
        v_outgoing.player_slug, v_outgoing.player_name, 'release', 0, v_round_key is not null
      );
    end if;

    insert into public.fantasy_vbf_roster_players (
      season, team_id, user_id, player_slug, player_name, player_tier, player_rank,
      buy_price, clause_price, acquisition_type, acquired_round_key
    )
    values (
      v_season,
      v_team.id,
      v_user,
      v_pool.player_slug,
      v_pool.player_name,
      v_pool.player_tier,
      v_pool.player_rank,
      v_buy_cost,
      v_pool.default_clause,
      'market',
      v_round_key
    );

    update public.fantasy_vbf_teams
    set coins = coins - v_buy_cost
    where id = v_team.id;

    insert into public.fantasy_vbf_transactions (
      season, round_key, team_id, user_id, player_slug, player_name, tx_type, amount, counts_as_transfer
    )
    values (
      v_season, v_round_key, v_team.id, v_user,
      v_pool.player_slug, v_pool.player_name, 'buy', v_buy_cost, v_round_key is not null
    );

    if v_round.id is not null then
      update public.fantasy_vbf_team_rounds
      set transfers_used = transfers_used + 1,
          synced_at = timezone('utc', now())
      where id = v_round.id;
    end if;

    return jsonb_build_object(
      'season', v_season,
      'team_id', v_team.id,
      'player_slug', v_slug,
      'mode', 'market',
      'cost', v_buy_cost,
      'coins_left', greatest(v_team.coins - v_buy_cost, 0)
    );
  end if;

  if p_target_team_id is null then
    raise exception 'Para pagar clausula debes elegir de que equipo quieres sacar el jugador.';
  end if;

  select * into v_target
  from public.fantasy_vbf_roster_players
  where season = v_season
    and team_id = p_target_team_id
    and player_slug = v_slug
    and team_id <> v_team.id
  limit 1
  for update;

  if not found then raise exception 'No encontre esa copia del jugador para pagar la clausula.'; end if;

  v_buy_cost := greatest(coalesce(v_target.clause_price, v_pool.default_clause), 0);
  if v_team.coins < v_buy_cost then raise exception 'No tienes berries suficientes para pagar la clausula.'; end if;

  if v_outgoing.id is not null then
    delete from public.fantasy_vbf_roster_players where id = v_outgoing.id;

    insert into public.fantasy_vbf_transactions (
      season, round_key, team_id, user_id, player_slug, player_name, tx_type, amount, counts_as_transfer
    )
    values (
      v_season, v_round_key, v_team.id, v_user,
      v_outgoing.player_slug, v_outgoing.player_name, 'release', 0, v_round_key is not null
    );
  end if;

  update public.fantasy_vbf_teams
  set coins = coins - v_buy_cost
  where id = v_team.id;

  update public.fantasy_vbf_teams
  set coins = coins + v_buy_cost
  where id = v_target.team_id;

  update public.fantasy_vbf_roster_players
  set team_id = v_team.id,
      user_id = v_user,
      player_name = v_pool.player_name,
      player_tier = v_pool.player_tier,
      player_rank = v_pool.player_rank,
      buy_price = v_buy_cost,
      clause_price = v_pool.default_clause,
      acquisition_type = 'buyout',
      acquired_round_key = v_round_key,
      created_at = timezone('utc', now())
  where id = v_target.id;

  insert into public.fantasy_vbf_transactions (
    season, round_key, team_id, user_id, player_slug, player_name, tx_type, amount, counts_as_transfer
  )
  values
    (v_season, v_round_key, v_team.id, v_user, v_pool.player_slug, v_pool.player_name, 'clause_in', v_buy_cost, v_round_key is not null),
    (v_season, v_round_key, v_target.team_id, v_target.user_id, v_pool.player_slug, v_pool.player_name, 'clause_out', v_buy_cost, false);

  insert into public.fantasy_vbf_notifications (season, user_id, team_id, kind, title, body, payload)
  values
    (
      v_season,
      v_target.user_id,
      v_target.team_id,
      'clause_lost',
      format('Te han pagado la clausula de %s', v_pool.player_name),
      format('El equipo %s te ha quitado a %s pagando %s berries. Esa cantidad entra en tu saldo.', v_team.team_name, v_pool.player_name, v_buy_cost),
      jsonb_build_object(
        'player_slug', v_pool.player_slug,
        'player_name', v_pool.player_name,
        'amount', v_buy_cost,
        'team_id', v_target.team_id,
        'seller_team_id', v_target.team_id,
        'seller_user_id', v_target.user_id,
        'buyer_team_id', v_team.id,
        'buyer_user_id', v_user,
        'buyer_team_name', v_team.team_name
      )
    ),
    (
      v_season,
      v_user,
      v_team.id,
      'clause_won',
      format('Has fichado a %s por clausula', v_pool.player_name),
      format('Has pagado %s berries y ya ocupa una plaza en tu plantilla.', v_buy_cost),
      jsonb_build_object(
        'player_slug', v_pool.player_slug,
        'player_name', v_pool.player_name,
        'amount', v_buy_cost,
        'team_id', v_team.id,
        'buyer_team_id', v_team.id,
        'buyer_user_id', v_user,
        'buyer_team_name', v_team.team_name,
        'seller_team_id', v_target.team_id,
        'seller_user_id', v_target.user_id
      )
    );

  if v_round.id is not null then
    update public.fantasy_vbf_team_rounds
    set transfers_used = transfers_used + 1,
        synced_at = timezone('utc', now())
    where id = v_round.id;
  end if;

  return jsonb_build_object(
    'season', v_season,
    'team_id', v_team.id,
    'player_slug', v_slug,
    'mode', 'buyout',
    'cost', v_buy_cost,
    'coins_left', greatest(v_team.coins - v_buy_cost, 0),
    'seller_team_id', v_target.team_id
  );
end;
$$;

create or replace function public.fantasy_vbf_sell_player(
  p_season text,
  p_round_key text,
  p_player_slug text,
  p_market_price integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := upper(trim(coalesce(p_season, '')));
  v_round_key text := nullif(trim(coalesce(p_round_key, '')), '');
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_team public.fantasy_vbf_teams%rowtype;
  v_roster public.fantasy_vbf_roster_players%rowtype;
  v_pool public.fantasy_vbf_player_pool%rowtype;
  v_roster_count integer := 0;
  v_sale_price integer := 0;
begin
  if v_user is null then raise exception 'Necesitas sesion para vender jugadores.'; end if;
  if v_season = '' then raise exception 'Temporada fantasy invalida.'; end if;
  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if v_cfg.is_open is not true then raise exception 'El mercado fantasy esta cerrado.'; end if;
  if public.fantasy_vbf_market_is_open(now()) is not true then
    raise exception 'Mercado cerrado.';
  end if;

  select * into v_team
  from public.fantasy_vbf_teams
  where season = v_season and user_id = v_user
  for update;

  if not found then raise exception 'No tienes equipo fantasy en esta temporada.'; end if;

  select * into v_roster
  from public.fantasy_vbf_roster_players
  where season = v_season
    and team_id = v_team.id
    and player_slug = trim(coalesce(p_player_slug, ''))
  for update;

  if not found then raise exception 'Ese jugador no esta en tu plantilla.'; end if;

  select count(*) into v_roster_count
  from public.fantasy_vbf_roster_players
  where team_id = v_team.id;

  if v_roster_count <= 1 then
    raise exception 'No puedes vender tu ultimo jugador.';
  end if;

  select * into v_pool
  from public.fantasy_vbf_player_pool
  where season = v_season and player_slug = v_roster.player_slug;

  v_sale_price := greatest(coalesce(v_pool.current_price, p_market_price, v_roster.buy_price, 0), 0);

  delete from public.fantasy_vbf_roster_players
  where id = v_roster.id;

  update public.fantasy_vbf_teams
  set coins = coins + v_sale_price,
      captain_player_slug = case when captain_player_slug = v_roster.player_slug then null else captain_player_slug end,
      updated_at = timezone('utc', now())
  where id = v_team.id;

  update public.fantasy_vbf_teams t
  set captain_player_slug = best.player_slug,
      updated_at = timezone('utc', now())
  from (
    select rp.team_id, rp.player_slug
    from public.fantasy_vbf_roster_players rp
    join public.fantasy_vbf_player_pool pp on pp.season = rp.season and pp.player_slug = rp.player_slug
    where rp.team_id = v_team.id
    order by pp.current_price desc, rp.player_rank asc, rp.created_at asc
    limit 1
  ) best
  where t.id = best.team_id
    and t.captain_player_slug is null;

  if v_round_key is not null then
    insert into public.fantasy_vbf_team_rounds (
      season, team_id, user_id, round_key, round_label, round_order,
      weekly_points, weekly_rank, reward_coins, transfers_used, captain_changes_used
    )
    values (
      v_season, v_team.id, v_user, v_round_key,
      coalesce(nullif(v_cfg.current_round_label, ''), v_round_key),
      coalesce(v_cfg.current_round_order, 0),
      0, null, 0, 0, 0
    )
    on conflict (season, team_id, round_key) do nothing;

    update public.fantasy_vbf_team_rounds
    set transfers_used = transfers_used + 1,
        synced_at = timezone('utc', now())
    where season = v_season and team_id = v_team.id and round_key = v_round_key;
  end if;

  insert into public.fantasy_vbf_transactions (
    season, round_key, team_id, user_id, player_slug, player_name, tx_type, amount, counts_as_transfer
  )
  values (
    v_season, v_round_key, v_team.id, v_user,
    v_roster.player_slug, v_roster.player_name, 'release', v_sale_price, v_round_key is not null
  );

  return jsonb_build_object(
    'season', v_season,
    'team_id', v_team.id,
    'player_slug', v_roster.player_slug,
    'mode', 'sell',
    'amount', v_sale_price,
    'coins_left', v_team.coins + v_sale_price
  );
end;
$$;

create or replace function public.fantasy_vbf_save_lineup(
  p_season text,
  p_player_ids jsonb default '[]'::jsonb,
  p_captain_player_slug text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := upper(trim(coalesce(p_season, '')));
  v_team public.fantasy_vbf_teams%rowtype;
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_owned text[];
  v_requested text[];
  v_captain text := nullif(trim(coalesce(p_captain_player_slug, '')), '');
begin
  if v_user is null then raise exception 'Debes iniciar sesion para guardar la plantilla.'; end if;
  if jsonb_typeof(coalesce(p_player_ids, '[]'::jsonb)) <> 'array' then raise exception 'La plantilla debe ser un array JSON.'; end if;

  select * into v_team
  from public.fantasy_vbf_teams
  where season = v_season and user_id = v_user
  for update;

  if not found then raise exception 'Primero debes crear tu equipo.'; end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if v_cfg.is_open is not true then raise exception 'El mercado esta cerrado. No puedes cambiar capitan ahora.'; end if;

  select coalesce(array_agg(player_slug order by created_at), array[]::text[])
  into v_owned
  from public.fantasy_vbf_roster_players
  where team_id = v_team.id;

  select coalesce(array_agg(value order by ord), array[]::text[])
  into v_requested
  from (
    select distinct on (value) value, ord
    from unnest(public.fantasy_vbf_jsonb_array_to_text_array(p_player_ids)) with ordinality as t(value, ord)
    order by value, ord
  ) dedup;

  if coalesce(array_length(v_requested, 1), 0) > 0 then
    if exists (select 1 from unnest(v_requested) as value where not (value = any(v_owned))) then
      raise exception 'Solo puedes guardar jugadores de tu plantilla.';
    end if;
    if coalesce(array_length(v_requested, 1), 0) <> coalesce(array_length(v_owned, 1), 0) then
      raise exception 'La plantilla activa debe contener todos tus jugadores.';
    end if;
  end if;

  if v_captain is not null and not (v_captain = any(v_owned)) then
    raise exception 'El capitan debe ser un jugador de tu plantilla.';
  end if;

  update public.fantasy_vbf_teams
  set captain_player_slug = v_captain
  where id = v_team.id;
end;
$$;

create or replace function public.fantasy_vbf_start_week(
  p_season text,
  p_week_key text,
  p_week_label text,
  p_week_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := upper(trim(coalesce(p_season, '')));
  v_week_key text := nullif(trim(coalesce(p_week_key, '')), '');
  v_week_label text := trim(coalesce(p_week_label, ''));
  v_week_order integer := greatest(coalesce(p_week_order, 0), 0);
  v_cfg public.fantasy_vbf_seasons%rowtype;
begin
  if v_user is null then raise exception 'Debes iniciar sesion para abrir una nueva jornada.'; end if;
  if v_week_key is null then raise exception 'La nueva jornada no tiene week_key valido.'; end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;

  if coalesce(v_cfg.current_round_key, '') = v_week_key then
    return jsonb_build_object('season', v_season, 'week_key', v_week_key, 'opened', false, 'reason', 'already-open');
  end if;

  insert into public.fantasy_vbf_rounds (season, round_key, round_label, round_order, rewards_applied)
  values (v_season, v_week_key, coalesce(nullif(v_week_label, ''), v_week_key), v_week_order, false)
  on conflict (season, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        rewards_applied = false,
        updated_at = timezone('utc', now());

  update public.fantasy_vbf_seasons
  set current_round_key = v_week_key,
      current_round_label = coalesce(nullif(v_week_label, ''), v_week_key),
      current_round_order = v_week_order
  where season = v_season;

  insert into public.fantasy_vbf_team_rounds (
    season, team_id, user_id, round_key, round_label, round_order,
    weekly_points, weekly_rank, reward_coins, transfers_used, captain_changes_used
  )
  select
    v_season,
    t.id,
    t.user_id,
    v_week_key,
    coalesce(nullif(v_week_label, ''), v_week_key),
    v_week_order,
    0, null, 0, 0, 0
  from public.fantasy_vbf_teams t
  where t.season = v_season
  on conflict (season, team_id, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        synced_at = timezone('utc', now());

  return jsonb_build_object('season', v_season, 'week_key', v_week_key, 'opened', true);
end;
$$;

create or replace function public.fantasy_vbf_capture_round_snapshot(
  p_season text,
  p_round_key text,
  p_round_label text default null,
  p_round_order integer default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := upper(trim(coalesce(p_season, '')));
  v_round_key text := nullif(trim(coalesce(p_round_key, '')), '');
  v_round_label text := nullif(trim(coalesce(p_round_label, '')), '');
  v_round_order integer;
  v_existing integer := 0;
  v_inserted integer := 0;
begin
  if v_user is null and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Debes iniciar sesion o ejecutar esta funcion desde backend para congelar la plantilla.';
  end if;
  if v_round_key is null then
    raise exception 'La jornada no tiene round_key valido para congelar la plantilla.';
  end if;

  select coalesce(max(round_order), 0) + 1
  into v_round_order
  from public.fantasy_vbf_rounds
  where season = v_season;

  v_round_order := greatest(coalesce(p_round_order, v_round_order, 1), 1);
  v_round_label := coalesce(v_round_label, v_round_key);

  insert into public.fantasy_vbf_rounds (season, round_key, round_label, round_order, rewards_applied)
  values (v_season, v_round_key, v_round_label, v_round_order, false)
  on conflict (season, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        updated_at = timezone('utc', now());

  select count(*)
  into v_existing
  from public.fantasy_vbf_roster_snapshots
  where season = v_season and round_key = v_round_key;

  if v_existing > 0 and not coalesce(p_force, false) then
    return jsonb_build_object(
      'season', v_season,
      'round_key', v_round_key,
      'captured', false,
      'reason', 'already-captured',
      'players', v_existing
    );
  end if;

  if coalesce(p_force, false) then
    delete from public.fantasy_vbf_roster_snapshots
    where season = v_season and round_key = v_round_key;
  end if;

  insert into public.fantasy_vbf_roster_snapshots (
    season, round_key, round_label, round_order,
    team_id, user_id, player_slug, player_name, player_tier, player_rank,
    buy_price, clause_price
  )
  select
    rp.season,
    v_round_key,
    v_round_label,
    v_round_order,
    rp.team_id,
    rp.user_id,
    rp.player_slug,
    rp.player_name,
    rp.player_tier,
    rp.player_rank,
    rp.buy_price,
    rp.clause_price
  from public.fantasy_vbf_roster_players rp
  join public.fantasy_vbf_teams t
    on t.id = rp.team_id and t.season = rp.season
  where rp.season = v_season;

  get diagnostics v_inserted = row_count;

  insert into public.fantasy_vbf_team_rounds (
    season, team_id, user_id, round_key, round_label, round_order,
    weekly_points, weekly_rank, reward_coins, transfers_used, captain_changes_used
  )
  select
    v_season, t.id, t.user_id, v_round_key, v_round_label, v_round_order,
    0, null, 0, 0, 0
  from public.fantasy_vbf_teams t
  where t.season = v_season
  on conflict (season, team_id, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        synced_at = timezone('utc', now());

  return jsonb_build_object(
    'season', v_season,
    'round_key', v_round_key,
    'captured', true,
    'players', v_inserted
  );
end;
$$;

create or replace function public.fantasy_vbf_capture_round_snapshot_for_date(
  p_season text,
  p_round_date date default (timezone('Europe/Madrid', now()))::date,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_round_date, (timezone('Europe/Madrid', now()))::date);
  v_season text := upper(trim(coalesce(p_season, '')));
  v_round_key text := format('%s:%s', v_season, to_char(v_date, 'YYYY-MM-DD'));
begin
  return public.fantasy_vbf_capture_round_snapshot(
    v_season,
    v_round_key,
    to_char(v_date, 'YYYY-MM-DD'),
    null,
    p_force
  );
end;
$$;

create or replace function public.fantasy_vbf_sync_round(
  p_season text,
  p_round_key text,
  p_round_label text,
  p_round_order integer,
  p_results jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := upper(trim(coalesce(p_season, '')));
  v_round_key text := nullif(trim(coalesce(p_round_key, '')), '');
  v_round_label text := coalesce(nullif(trim(coalesce(p_round_label, '')), ''), v_round_key);
  v_round_order integer := greatest(coalesce(p_round_order, 0), 0);
  v_rewards_applied boolean := false;
  v_snapshot_count integer := 0;
  v_pool_ready integer := 0;
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_row record;
  v_reward integer := 0;
begin
  if v_user is null and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Debes iniciar sesion o ejecutar esta funcion desde backend para sincronizar.';
  end if;
  if v_round_key is null then raise exception 'La jornada no tiene week_key valido.'; end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;

  insert into public.fantasy_vbf_rounds (season, round_key, round_label, round_order, rewards_applied)
  values (v_season, v_round_key, v_round_label, v_round_order, false)
  on conflict (season, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        updated_at = timezone('utc', now());

  insert into public.fantasy_vbf_team_rounds (
    season, team_id, user_id, round_key, round_label, round_order,
    weekly_points, weekly_rank, reward_coins, transfers_used, captain_changes_used
  )
  select
    v_season, t.id, t.user_id, v_round_key, v_round_label, v_round_order,
    0, null, 0, 0, 0
  from public.fantasy_vbf_teams t
  where t.season = v_season
  on conflict (season, team_id, round_key) do nothing;

  select rewards_applied into v_rewards_applied
  from public.fantasy_vbf_rounds
  where season = v_season and round_key = v_round_key;

  if coalesce(v_rewards_applied, false) is true then
    return jsonb_build_object('season', v_season, 'round_key', v_round_key, 'synced', false, 'reason', 'already-closed');
  end if;

  select count(*)
  into v_snapshot_count
  from public.fantasy_vbf_roster_snapshots
  where season = v_season and round_key = v_round_key;

  if v_snapshot_count = 0 and exists(select 1 from public.fantasy_vbf_teams where season = v_season) then
    raise exception 'La jornada % no tiene snapshot de plantilla. Debes congelar la plantilla del sabado antes de sincronizar resultados.', v_round_key;
  end if;

  select count(*)
  into v_pool_ready
  from public.fantasy_vbf_player_pool
  where season = v_season and current_round_key = v_round_key;

  if v_pool_ready = 0 then
    raise exception 'El pool fantasy aun no esta sincronizado con la jornada %.', v_round_key;
  end if;

  update public.fantasy_vbf_team_rounds tr
  set weekly_points = coalesce(scores.weekly_points, 0),
      round_label = v_round_label,
      round_order = v_round_order,
      synced_at = timezone('utc', now())
  from public.fantasy_vbf_teams t
  left join (
    select
      rs.team_id,
      sum(
        case
          when t.captain_player_slug = rs.player_slug then coalesce(pp.current_fantasy_points, 0) * greatest(coalesce(v_cfg.captain_multiplier, 1), 1)
          else coalesce(pp.current_fantasy_points, 0)
        end
      ) as weekly_points
    from public.fantasy_vbf_roster_snapshots rs
    join public.fantasy_vbf_teams t on t.id = rs.team_id
    left join public.fantasy_vbf_player_pool pp
      on pp.season = rs.season and pp.player_slug = rs.player_slug
    where rs.season = v_season
      and rs.round_key = v_round_key
    group by rs.team_id
  ) scores on scores.team_id = t.id
  where tr.season = v_season
    and tr.round_key = v_round_key
    and tr.team_id = t.id
    and t.season = v_season;

  with ranked as (
    select
      tr.id,
      row_number() over (order by tr.weekly_points desc, t.team_name asc, tr.team_id asc) as row_rank
    from public.fantasy_vbf_team_rounds tr
    join public.fantasy_vbf_teams t on t.id = tr.team_id
    where tr.season = v_season and tr.round_key = v_round_key
  )
  update public.fantasy_vbf_team_rounds tr
  set weekly_rank = ranked.row_rank
  from ranked
  where ranked.id = tr.id;

  if coalesce(v_rewards_applied, false) is false then
    for v_row in
      select team_id, user_id, weekly_points
      from public.fantasy_vbf_team_rounds
      where season = v_season and round_key = v_round_key
    loop
      v_reward := greatest(round(coalesce(v_row.weekly_points, 0) * 3000)::integer, coalesce(v_cfg.weekly_base_reward, 20000), 0);

      update public.fantasy_vbf_teams
      set coins = coins + v_reward
      where id = v_row.team_id;

      update public.fantasy_vbf_team_rounds
      set reward_coins = v_reward
      where season = v_season and round_key = v_round_key and team_id = v_row.team_id;

      insert into public.fantasy_vbf_transactions (
        season, round_key, team_id, user_id, player_slug, player_name, tx_type, amount, counts_as_transfer
      )
      values (
        v_season, v_round_key, v_row.team_id, v_row.user_id,
        null, null, 'system_reward', v_reward, false
      );

      insert into public.fantasy_vbf_notifications (season, user_id, team_id, kind, title, body, payload)
      values (
        v_season,
        v_row.user_id,
        v_row.team_id,
        'weekly_reward',
        format('Recompensa aplicada en %s', v_round_label),
        format('Has recibido %s berries por el rendimiento de tu plantilla en la jornada.', v_reward),
        jsonb_build_object('round_key', v_round_key, 'reward', v_reward, 'weekly_points', v_row.weekly_points)
      );
    end loop;

    update public.fantasy_vbf_rounds
    set rewards_applied = true
    where season = v_season and round_key = v_round_key;
  end if;

  update public.fantasy_vbf_teams t
  set total_points = coalesce(points.total_points, 0)
  from (
    select team_id, sum(weekly_points) as total_points
    from public.fantasy_vbf_team_rounds
    where season = v_season
    group by team_id
  ) points
  where t.id = points.team_id;

  return jsonb_build_object('season', v_season, 'round_key', v_round_key, 'synced', true);
end;
$$;

create or replace function public.fantasy_vbf_mark_notifications_read(
  p_ids jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user is null then raise exception 'Debes iniciar sesion.'; end if;
  if jsonb_typeof(coalesce(p_ids, '[]'::jsonb)) <> 'array' then raise exception 'Los ids deben llegar en un array JSON.'; end if;

  update public.fantasy_vbf_notifications
  set read_at = timezone('utc', now())
  where user_id = v_user
    and read_at is null
    and id = any(public.fantasy_vbf_jsonb_array_to_text_array(p_ids)::uuid[]);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.fantasy_vbf_rename_team(
  p_season text,
  p_team_name text
)
returns public.fantasy_vbf_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := left(btrim(coalesce(p_team_name, '')), 60);
  v_team public.fantasy_vbf_teams%rowtype;
begin
  if v_user is null then raise exception 'Debes iniciar sesion.'; end if;
  if v_name = '' then raise exception 'El nombre del equipo no puede estar vacio.'; end if;

  update public.fantasy_vbf_teams
  set team_name = v_name
  where season = coalesce(nullif(btrim(p_season), ''), 'OP15')
    and user_id = v_user
  returning * into v_team;

  if not found then raise exception 'No tienes equipo en esta temporada.'; end if;
  return v_team;
end;
$$;

grant execute on function public.fantasy_vbf_market_is_open(timestamptz) to anon, authenticated;
grant execute on function public.fantasy_vbf_create_team(text, text, jsonb) to authenticated;
grant execute on function public.fantasy_vbf_buy_player(text, text, text, text, uuid) to authenticated;
grant execute on function public.fantasy_vbf_sell_player(text, text, text, integer) to authenticated;
grant execute on function public.fantasy_vbf_save_lineup(text, jsonb, text) to authenticated;
grant execute on function public.fantasy_vbf_start_week(text, text, text, integer) to authenticated;
grant execute on function public.fantasy_vbf_sync_round(text, text, text, integer, jsonb) to authenticated;
grant execute on function public.fantasy_vbf_sync_player_pool(text, text, text, integer, jsonb) to authenticated;
grant execute on function public.fantasy_vbf_mark_notifications_read(jsonb) to authenticated;
grant execute on function public.fantasy_vbf_rename_team(text, text) to authenticated;
