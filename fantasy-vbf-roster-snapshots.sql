-- Fantasy OP15 - snapshot de plantilla por jornada
--
-- Objetivo:
-- 1) congelar la plantilla del sabado a las 00:00 (Europe/Madrid)
-- 2) calcular la jornada cuando el Excel se actualice dias despues
-- 3) evitar que un cambio de equipo posterior altere la jornada ya jugada
--
-- Uso recomendado:
--   -- Cron semanal, sabado 00:00 Europe/Madrid
--   select public.fantasy_vbf_capture_round_snapshot_for_date('OP15');
--
--   -- Cuando ya se haya sincronizado el pool con los resultados del sabado
--   -- y el current_round_key del pool coincida con esa fecha:
--   -- ejemplo:
--   -- select public.fantasy_vbf_sync_round('OP15', 'OP15:2026-05-09', '9-may', 6, '[]'::jsonb);

create table if not exists public.fantasy_vbf_roster_snapshots (
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

create index if not exists fantasy_vbf_roster_snapshots_team_idx
  on public.fantasy_vbf_roster_snapshots (season, round_key, team_id, captured_at desc);

create index if not exists fantasy_vbf_roster_snapshots_slug_idx
  on public.fantasy_vbf_roster_snapshots (season, player_slug, round_key, captured_at desc);

alter table public.fantasy_vbf_roster_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fantasy_vbf_roster_snapshots'
      and policyname = 'fantasy_vbf_roster_snapshots_select_all'
  ) then
    create policy fantasy_vbf_roster_snapshots_select_all
      on public.fantasy_vbf_roster_snapshots
      for select
      using (true);
  end if;
end;
$$;

revoke all on public.fantasy_vbf_roster_snapshots from public;
grant select on public.fantasy_vbf_roster_snapshots to anon, authenticated;

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
  v_row record;
  v_reward integer := 0;
begin
  if v_user is null and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Debes iniciar sesion o ejecutar esta funcion desde backend para sincronizar.';
  end if;
  if v_round_key is null then
    raise exception 'La jornada no tiene week_key valido.';
  end if;

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
    select rs.team_id, sum(coalesce(pp.current_fantasy_points, 0)) as weekly_points
    from public.fantasy_vbf_roster_snapshots rs
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
      v_reward := greatest(round(coalesce(v_row.weekly_points, 0) * 1000)::integer, 0);

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
