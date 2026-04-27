-- Fantasy VBF schema - Salary Cap semanal OP15

create extension if not exists pgcrypto;

drop table if exists public.fantasy_vbf_team_rounds cascade;
drop table if exists public.fantasy_vbf_rounds cascade;
drop table if exists public.fantasy_vbf_transactions cascade;
drop table if exists public.fantasy_vbf_roster_players cascade;
drop table if exists public.fantasy_vbf_members cascade;
drop table if exists public.fantasy_vbf_leagues cascade;
drop table if exists public.fantasy_vbf_teams cascade;
drop table if exists public.fantasy_vbf_seasons cascade;

drop function if exists public.fantasy_vbf_sync_round(text, text, text, integer, jsonb);
drop function if exists public.fantasy_vbf_save_lineup(text, jsonb, text);
drop function if exists public.fantasy_vbf_sell_player(text, text, text);
drop function if exists public.fantasy_vbf_sell_player(text, text);
drop function if exists public.fantasy_vbf_buy_player(text, text, text, text, integer, integer);
drop function if exists public.fantasy_vbf_buy_player(text, text, text, text, integer);
drop function if exists public.fantasy_vbf_create_team(text, text);
drop function if exists public.fantasy_vbf_jsonb_array_to_text_array(jsonb);
drop function if exists public.fantasy_vbf_weekly_bonus(integer, integer);
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

create or replace function public.fantasy_vbf_weekly_bonus(p_rank integer, p_team_count integer)
returns integer
language plpgsql
immutable
as $$
begin
  if coalesce(p_rank, 0) <= 0 or coalesce(p_team_count, 0) <= 0 then
    return 0;
  end if;
  if p_rank = 1 then return 8; end if;
  if p_rank = 2 then return 6; end if;
  if p_rank = 3 then return 5; end if;
  if p_rank <= least(10, p_team_count) then return 4; end if;
  if p_rank <= ceil(p_team_count::numeric / 2.0)::integer then return 2; end if;
  return 1;
end;
$$;

create table public.fantasy_vbf_seasons (
  season text primary key,
  label text not null,
  budget integer not null default 40 check (budget > 0),
  squad_size integer not null default 5 check (squad_size = 5),
  starter_size integer not null default 5 check (starter_size = 5),
  max_weekly_transfers integer not null default 2 check (max_weekly_transfers between 0 and 10),
  weekly_base_reward integer not null default 10 check (weekly_base_reward >= 0),
  max_savings integer not null default 60 check (max_savings >= 0),
  captain_multiplier numeric(4,2) not null default 1.5 check (captain_multiplier >= 1),
  is_open boolean not null default true,
  current_round_key text,
  current_round_label text,
  current_round_order integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
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
  buy_price integer not null check (buy_price >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (season, team_id, player_slug)
);

create table public.fantasy_vbf_transactions (
  id uuid primary key default gen_random_uuid(),
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  round_key text,
  team_id uuid not null references public.fantasy_vbf_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_slug text not null,
  player_name text,
  tx_type text not null check (tx_type in ('buy', 'sell')),
  amount integer not null check (amount >= 0),
  counts_as_transfer boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
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
  synced_at timestamptz not null default timezone('utc', now()),
  unique (season, team_id, round_key)
);

create index fantasy_vbf_teams_season_idx on public.fantasy_vbf_teams (season, created_at desc);
create index fantasy_vbf_roster_team_idx on public.fantasy_vbf_roster_players (team_id, created_at desc);
create index fantasy_vbf_team_rounds_round_idx on public.fantasy_vbf_team_rounds (season, round_key, weekly_rank);
create index fantasy_vbf_transactions_round_idx on public.fantasy_vbf_transactions (season, round_key, created_at desc);

create trigger fantasy_vbf_seasons_touch_updated_at before update on public.fantasy_vbf_seasons for each row execute function public.fantasy_vbf_touch_updated_at();
create trigger fantasy_vbf_teams_touch_updated_at before update on public.fantasy_vbf_teams for each row execute function public.fantasy_vbf_touch_updated_at();
create trigger fantasy_vbf_rounds_touch_updated_at before update on public.fantasy_vbf_rounds for each row execute function public.fantasy_vbf_touch_updated_at();

insert into public.fantasy_vbf_seasons (season, label, budget, squad_size, starter_size, max_weekly_transfers, weekly_base_reward, max_savings, captain_multiplier, is_open)
values ('OP15', 'Fantasy OP15', 40, 5, 5, 2, 10, 60, 1.5, true);

alter table public.fantasy_vbf_seasons enable row level security;
alter table public.fantasy_vbf_teams enable row level security;
alter table public.fantasy_vbf_roster_players enable row level security;
alter table public.fantasy_vbf_transactions enable row level security;
alter table public.fantasy_vbf_rounds enable row level security;
alter table public.fantasy_vbf_team_rounds enable row level security;

create policy fantasy_vbf_seasons_select_all on public.fantasy_vbf_seasons for select using (true);
create policy fantasy_vbf_teams_select_all on public.fantasy_vbf_teams for select using (true);
create policy fantasy_vbf_roster_select_all on public.fantasy_vbf_roster_players for select using (true);
create policy fantasy_vbf_transactions_select_all on public.fantasy_vbf_transactions for select using (true);
create policy fantasy_vbf_rounds_select_all on public.fantasy_vbf_rounds for select using (true);
create policy fantasy_vbf_team_rounds_select_all on public.fantasy_vbf_team_rounds for select using (true);

revoke all on public.fantasy_vbf_seasons from public;
revoke all on public.fantasy_vbf_teams from public;
revoke all on public.fantasy_vbf_roster_players from public;
revoke all on public.fantasy_vbf_transactions from public;
revoke all on public.fantasy_vbf_rounds from public;
revoke all on public.fantasy_vbf_team_rounds from public;

grant select on public.fantasy_vbf_seasons to anon, authenticated;
grant select on public.fantasy_vbf_teams to anon, authenticated;
grant select on public.fantasy_vbf_roster_players to anon, authenticated;
grant select on public.fantasy_vbf_transactions to anon, authenticated;
grant select on public.fantasy_vbf_rounds to anon, authenticated;
grant select on public.fantasy_vbf_team_rounds to anon, authenticated;

create or replace function public.fantasy_vbf_create_team(
  p_season text,
  p_team_name text
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
begin
  if v_user is null then raise exception 'Debes iniciar sesion para crear tu equipo.'; end if;
  if char_length(v_name) < 3 then raise exception 'El nombre del equipo es demasiado corto.'; end if;

  select * into v_cfg from public.fantasy_vbf_seasons where season = v_season for update;
  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if v_cfg.is_open is not true then raise exception 'La temporada no esta abierta.'; end if;

  select id into v_team_id from public.fantasy_vbf_teams where season = v_season and user_id = v_user;
  if found then return v_team_id; end if;

  insert into public.fantasy_vbf_teams (season, user_id, team_name, coins)
  values (v_season, v_user, v_name, v_cfg.budget)
  returning id into v_team_id;

  return v_team_id;
end;
$$;

create or replace function public.fantasy_vbf_buy_player(
  p_season text,
  p_round_key text,
  p_player_slug text,
  p_player_name text,
  p_player_tier text,
  p_player_rank integer,
  p_price integer
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
  v_name text := trim(coalesce(p_player_name, ''));
  v_tier text := trim(coalesce(p_player_tier, ''));
  v_rank integer := greatest(coalesce(p_player_rank, 9999), 1);
  v_price integer := greatest(coalesce(p_price, 0), 0);
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_team public.fantasy_vbf_teams%rowtype;
  v_roster_count integer := 0;
  v_top5_count integer := 0;
  v_top10_count integer := 0;
begin
  if v_user is null then raise exception 'Debes iniciar sesion para comprar.'; end if;
  if v_slug = '' or v_name = '' then raise exception 'Jugador invalido.'; end if;

  select * into v_cfg from public.fantasy_vbf_seasons where season = v_season for update;
  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if v_cfg.is_open is not true then raise exception 'El mercado esta cerrado.'; end if;

  select * into v_team from public.fantasy_vbf_teams where season = v_season and user_id = v_user for update;
  if not found then raise exception 'Primero debes crear tu equipo.'; end if;

  select count(*) into v_roster_count from public.fantasy_vbf_roster_players where team_id = v_team.id;
  if exists (select 1 from public.fantasy_vbf_roster_players where team_id = v_team.id and player_slug = v_slug) then raise exception 'Ese jugador ya esta en tu plantilla.'; end if;
  if v_roster_count >= v_cfg.squad_size then raise exception 'Tu plantilla ya esta completa.'; end if;
  if v_team.coins < v_price then raise exception 'No tienes coins suficientes.'; end if;

  select count(*) into v_top5_count from public.fantasy_vbf_roster_players where team_id = v_team.id and player_rank <= 5;
  select count(*) into v_top10_count from public.fantasy_vbf_roster_players where team_id = v_team.id and player_rank <= 10;
  if v_rank <= 5 and v_top5_count >= 1 then raise exception 'Solo puedes tener 1 jugador top5.'; end if;
  if v_rank <= 10 and v_top10_count >= 2 then raise exception 'Solo puedes tener 2 jugadores top10.'; end if;

  insert into public.fantasy_vbf_roster_players (season, team_id, user_id, player_slug, player_name, player_tier, player_rank, buy_price)
  values (v_season, v_team.id, v_user, v_slug, v_name, v_tier, v_rank, v_price);

  update public.fantasy_vbf_teams
  set coins = coins - v_price,
      captain_player_slug = case when nullif(trim(coalesce(captain_player_slug, '')), '') is null then v_slug else captain_player_slug end
  where id = v_team.id;

  insert into public.fantasy_vbf_transactions (season, round_key, team_id, user_id, player_slug, player_name, tx_type, amount, counts_as_transfer)
  values (v_season, v_round_key, v_team.id, v_user, v_slug, v_name, 'buy', v_price, false);

  return jsonb_build_object('season', v_season, 'team_id', v_team.id, 'player_slug', v_slug, 'coins_left', v_team.coins - v_price);
end;
$$;

create or replace function public.fantasy_vbf_sell_player(
  p_season text,
  p_round_key text,
  p_player_slug text
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
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_team public.fantasy_vbf_teams%rowtype;
  v_player public.fantasy_vbf_roster_players%rowtype;
  v_round public.fantasy_vbf_team_rounds%rowtype;
  v_roster_count integer := 0;
  v_counts_as_transfer boolean := false;
begin
  if v_user is null then raise exception 'Debes iniciar sesion para vender.'; end if;
  if v_slug = '' then raise exception 'Operacion invalida.'; end if;

  select * into v_cfg from public.fantasy_vbf_seasons where season = v_season for update;
  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if v_cfg.is_open is not true then raise exception 'El mercado esta cerrado.'; end if;

  select * into v_team from public.fantasy_vbf_teams where season = v_season and user_id = v_user for update;
  if not found then raise exception 'Primero debes crear tu equipo.'; end if;

  select count(*) into v_roster_count from public.fantasy_vbf_roster_players where team_id = v_team.id;
  select * into v_player from public.fantasy_vbf_roster_players where season = v_season and team_id = v_team.id and player_slug = v_slug for update;
  if not found then raise exception 'Ese jugador no esta en tu plantilla.'; end if;

  v_counts_as_transfer := v_round_key is not null and v_roster_count >= v_cfg.squad_size;
  if v_counts_as_transfer then
    insert into public.fantasy_vbf_team_rounds (season, team_id, user_id, round_key, round_label, round_order, weekly_points, weekly_rank, reward_coins, transfers_used)
    values (v_season, v_team.id, v_user, v_round_key, v_round_key, 0, 0, null, 0, 0)
    on conflict (season, team_id, round_key) do nothing;

    select * into v_round from public.fantasy_vbf_team_rounds where season = v_season and team_id = v_team.id and round_key = v_round_key for update;
    if coalesce(v_round.transfers_used, 0) >= v_cfg.max_weekly_transfers then raise exception 'Ya has usado tus cambios de esta semana.'; end if;
  end if;

  delete from public.fantasy_vbf_roster_players where id = v_player.id;

  update public.fantasy_vbf_teams
  set coins = coins + v_player.buy_price,
      captain_player_slug = case when coalesce(captain_player_slug, '') = v_slug then null else captain_player_slug end
  where id = v_team.id;

  if v_counts_as_transfer then
    update public.fantasy_vbf_team_rounds
    set transfers_used = transfers_used + 1,
        synced_at = timezone('utc', now())
    where season = v_season and team_id = v_team.id and round_key = v_round_key;
  end if;

  insert into public.fantasy_vbf_transactions (season, round_key, team_id, user_id, player_slug, player_name, tx_type, amount, counts_as_transfer)
  values (v_season, v_round_key, v_team.id, v_user, v_slug, v_player.player_name, 'sell', v_player.buy_price, v_counts_as_transfer);

  return jsonb_build_object('season', v_season, 'team_id', v_team.id, 'player_slug', v_slug, 'coins_now', v_team.coins + v_player.buy_price, 'counts_as_transfer', v_counts_as_transfer);
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
  v_owned text[];
  v_requested text[];
  v_captain text := nullif(trim(coalesce(p_captain_player_slug, '')), '');
begin
  if v_user is null then raise exception 'Debes iniciar sesion para guardar la plantilla.'; end if;
  if jsonb_typeof(coalesce(p_player_ids, '[]'::jsonb)) <> 'array' then raise exception 'La plantilla debe ser un array JSON.'; end if;

  select * into v_team from public.fantasy_vbf_teams where season = v_season and user_id = v_user for update;
  if not found then raise exception 'Primero debes crear tu equipo.'; end if;

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
      raise exception 'La plantilla activa debe contener tus 5 jugadores.';
    end if;
  end if;

  if v_captain is not null and not (v_captain = any(v_owned)) then
    raise exception 'El capitan debe estar en tu plantilla.';
  end if;

  update public.fantasy_vbf_teams
  set captain_player_slug = v_captain
  where id = v_team.id;
end;
$$;

create or replace function public.fantasy_vbf_sync_round(
  p_season text,
  p_round_key text,
  p_round_label text,
  p_round_order integer,
  p_results jsonb
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
  v_round_label text := trim(coalesce(p_round_label, ''));
  v_round_order integer := greatest(coalesce(p_round_order, 0), 0);
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_rewards_applied boolean := false;
  v_team_count integer := 0;
  v_row record;
  v_reward integer := 0;
begin
  if v_user is null then raise exception 'Debes iniciar sesion para sincronizar la jornada.'; end if;
  if v_round_key is null then raise exception 'La jornada actual no es valida.'; end if;
  if jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' then raise exception 'Los resultados deben ser un array JSON.'; end if;

  select * into v_cfg from public.fantasy_vbf_seasons where season = v_season for update;
  if not found then raise exception 'La temporada fantasy no existe.'; end if;

  insert into public.fantasy_vbf_rounds (season, round_key, round_label, round_order, rewards_applied)
  values (v_season, v_round_key, coalesce(nullif(v_round_label, ''), v_round_key), v_round_order, false)
  on conflict (season, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        updated_at = timezone('utc', now());

  select rewards_applied into v_rewards_applied
  from public.fantasy_vbf_rounds
  where season = v_season and round_key = v_round_key
  for update;

  update public.fantasy_vbf_seasons
  set current_round_key = v_round_key,
      current_round_label = coalesce(nullif(v_round_label, ''), v_round_key),
      current_round_order = v_round_order
  where season = v_season;

  insert into public.fantasy_vbf_team_rounds (season, team_id, user_id, round_key, round_label, round_order, weekly_points, weekly_rank, reward_coins, transfers_used)
  select v_season, t.id, t.user_id, v_round_key, coalesce(nullif(v_round_label, ''), v_round_key), v_round_order, greatest(coalesce(payload.weekly_points, 0), 0), null, 0, 0
  from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as payload(team_id uuid, weekly_points numeric)
  join public.fantasy_vbf_teams t on t.id = payload.team_id and t.season = v_season
  on conflict (season, team_id, round_key) do update
    set user_id = excluded.user_id,
        round_label = excluded.round_label,
        round_order = excluded.round_order,
        weekly_points = excluded.weekly_points,
        synced_at = timezone('utc', now());

  with ranked as (
    select id, rank() over (order by weekly_points desc, team_id asc) as next_rank
    from public.fantasy_vbf_team_rounds
    where season = v_season and round_key = v_round_key
  )
  update public.fantasy_vbf_team_rounds tr
  set weekly_rank = ranked.next_rank,
      round_label = coalesce(nullif(v_round_label, ''), v_round_key),
      round_order = v_round_order,
      synced_at = timezone('utc', now())
  from ranked
  where tr.id = ranked.id;

  if v_rewards_applied is not true then
    select count(*) into v_team_count
    from public.fantasy_vbf_team_rounds
    where season = v_season and round_key = v_round_key;

    for v_row in
      select id, team_id, weekly_rank
      from public.fantasy_vbf_team_rounds
      where season = v_season and round_key = v_round_key
    loop
      v_reward := v_cfg.weekly_base_reward + public.fantasy_vbf_weekly_bonus(v_row.weekly_rank, v_team_count);

      update public.fantasy_vbf_teams
      set coins = case when coins >= v_cfg.max_savings then coins else least(v_cfg.max_savings, coins + v_reward) end
      where id = v_row.team_id;

      update public.fantasy_vbf_team_rounds
      set reward_coins = v_reward
      where id = v_row.id;
    end loop;

    update public.fantasy_vbf_rounds
    set rewards_applied = true,
        updated_at = timezone('utc', now())
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

  update public.fantasy_vbf_teams t
  set total_points = 0
  where season = v_season
    and not exists (
      select 1
      from public.fantasy_vbf_team_rounds tr
      where tr.season = v_season
        and tr.team_id = t.id
    );

  return jsonb_build_object('season', v_season, 'round_key', v_round_key, 'rewards_applied', true);
end;
$$;

grant execute on function public.fantasy_vbf_create_team(text, text) to authenticated;
grant execute on function public.fantasy_vbf_buy_player(text, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.fantasy_vbf_sell_player(text, text, text) to authenticated;
grant execute on function public.fantasy_vbf_save_lineup(text, jsonb, text) to authenticated;
grant execute on function public.fantasy_vbf_sync_round(text, text, text, integer, jsonb) to authenticated;
