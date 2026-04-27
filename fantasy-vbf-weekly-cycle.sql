-- Weekly cycle upgrade for Fantasy VBF OP15
-- Run this after fantasy-vbf-schema.sql

alter table public.fantasy_vbf_seasons
  add column if not exists max_weekly_captain_changes integer not null default 1
  check (max_weekly_captain_changes between 0 and 10);

alter table public.fantasy_vbf_team_rounds
  add column if not exists captain_changes_used integer not null default 0;

update public.fantasy_vbf_seasons
set max_weekly_captain_changes = coalesce(max_weekly_captain_changes, 1)
where season = 'OP15';

update public.fantasy_vbf_team_rounds
set captain_changes_used = 0
where captain_changes_used is null;

drop function if exists public.fantasy_vbf_save_lineup(text, jsonb, text);

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
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_team public.fantasy_vbf_teams%rowtype;
  v_owned text[];
  v_requested text[];
  v_captain text := nullif(trim(coalesce(p_captain_player_slug, '')), '');
  v_prev_captain text;
  v_round public.fantasy_vbf_team_rounds%rowtype;
begin
  if v_user is null then
    raise exception 'Debes iniciar sesion para guardar la plantilla.';
  end if;

  if jsonb_typeof(coalesce(p_player_ids, '[]'::jsonb)) <> 'array' then
    raise exception 'La plantilla debe ser un array JSON.';
  end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then
    raise exception 'La temporada fantasy no existe.';
  end if;

  select * into v_team
  from public.fantasy_vbf_teams
  where season = v_season and user_id = v_user
  for update;

  if not found then
    raise exception 'Primero debes crear tu equipo.';
  end if;

  v_prev_captain := nullif(trim(coalesce(v_team.captain_player_slug, '')), '');

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
    if exists (
      select 1
      from unnest(v_requested) as value
      where not (value = any(v_owned))
    ) then
      raise exception 'Solo puedes guardar jugadores de tu plantilla.';
    end if;

    if coalesce(array_length(v_requested, 1), 0) <> coalesce(array_length(v_owned, 1), 0) then
      raise exception 'La plantilla activa debe contener tus 5 jugadores.';
    end if;
  end if;

  if v_captain is not null and not (v_captain = any(v_owned)) then
    raise exception 'El capitan debe estar en tu plantilla.';
  end if;

  if v_cfg.current_round_key is not null then
    insert into public.fantasy_vbf_team_rounds (
      season, team_id, user_id, round_key, round_label, round_order,
      weekly_points, weekly_rank, reward_coins, transfers_used, captain_changes_used
    )
    values (
      v_season,
      v_team.id,
      v_user,
      v_cfg.current_round_key,
      coalesce(nullif(v_cfg.current_round_label, ''), v_cfg.current_round_key),
      coalesce(v_cfg.current_round_order, 0),
      0,
      null,
      0,
      0,
      0
    )
    on conflict (season, team_id, round_key) do nothing;

    select * into v_round
    from public.fantasy_vbf_team_rounds
    where season = v_season
      and team_id = v_team.id
      and round_key = v_cfg.current_round_key
    for update;
  end if;

  if v_captain is distinct from v_prev_captain and v_captain is not null and v_cfg.current_round_key is not null then
    if coalesce(v_round.captain_changes_used, 0) >= coalesce(v_cfg.max_weekly_captain_changes, 1) then
      raise exception 'Ya has usado tu cambio de capitan de esta jornada.';
    end if;

    update public.fantasy_vbf_team_rounds
    set captain_changes_used = captain_changes_used + 1,
        synced_at = timezone('utc', now())
    where id = v_round.id;
  end if;

  update public.fantasy_vbf_teams
  set captain_player_slug = v_captain
  where id = v_team.id;
end;
$$;

drop function if exists public.fantasy_vbf_start_week(text, text, text, integer);

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
  v_team_count integer := 0;
begin
  if v_user is null then
    raise exception 'Debes iniciar sesion para abrir una nueva jornada.';
  end if;

  if v_week_key is null then
    raise exception 'La nueva jornada no tiene week_key valido.';
  end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then
    raise exception 'La temporada fantasy no existe.';
  end if;

  if coalesce(v_cfg.current_round_key, '') = v_week_key then
    return jsonb_build_object(
      'season', v_season,
      'week_key', v_week_key,
      'reset_applied', false,
      'reason', 'already-open'
    );
  end if;

  insert into public.fantasy_vbf_rounds (season, round_key, round_label, round_order, rewards_applied)
  values (v_season, v_week_key, coalesce(nullif(v_week_label, ''), v_week_key), v_week_order, false)
  on conflict (season, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        updated_at = timezone('utc', now());

  update public.fantasy_vbf_seasons
  set current_round_key = v_week_key,
      current_round_label = coalesce(nullif(v_week_label, ''), v_week_key),
      current_round_order = v_week_order
  where season = v_season;

  update public.fantasy_vbf_teams t
  set coins = coins + coalesce(refunds.total_refund, 0)
  from (
    select team_id, sum(buy_price) as total_refund
    from public.fantasy_vbf_roster_players
    where season = v_season
    group by team_id
  ) refunds
  where t.id = refunds.team_id
    and t.season = v_season;

  delete from public.fantasy_vbf_roster_players
  where season = v_season;

  update public.fantasy_vbf_teams
  set captain_player_slug = null
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
    0,
    null,
    0,
    0,
    0
  from public.fantasy_vbf_teams t
  where t.season = v_season
  on conflict (season, team_id, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        weekly_points = 0,
        weekly_rank = null,
        reward_coins = 0,
        transfers_used = 0,
        captain_changes_used = 0,
        synced_at = timezone('utc', now());

  select count(*) into v_team_count
  from public.fantasy_vbf_teams
  where season = v_season;

  return jsonb_build_object(
    'season', v_season,
    'week_key', v_week_key,
    'reset_applied', true,
    'teams_reset', v_team_count
  );
end;
$$;

grant execute on function public.fantasy_vbf_save_lineup(text, jsonb, text) to authenticated;
grant execute on function public.fantasy_vbf_start_week(text, text, text, integer) to authenticated;
