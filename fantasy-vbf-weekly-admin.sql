-- Weekly fantasy admin controls.
-- Apply this after fantasy-vbf-schema.sql / fantasy-vbf-roster-snapshots.sql.

create or replace function public.fantasy_vbf_require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text := '';
begin
  if v_user is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  select coalesce(app_role, '')
  into v_role
  from public.profiles
  where id = v_user;

  if coalesce(v_role, '') <> 'admin' then
    raise exception 'Solo un admin puede ejecutar esta accion.';
  end if;
end;
$$;

create or replace function public.fantasy_vbf_market_is_open(p_now timestamptz default now())
returns boolean
language sql
stable
as $$
  select extract(isodow from timezone('Europe/Madrid', coalesce(p_now, now())))::integer not in (6, 7)
$$;

create or replace function public.fantasy_vbf_lock_round(
  p_season text,
  p_round_key text,
  p_round_label text,
  p_round_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := upper(trim(coalesce(p_season, '')));
  v_round_key text := nullif(trim(coalesce(p_round_key, '')), '');
  v_round_label text := trim(coalesce(p_round_label, ''));
  v_round_order integer := greatest(coalesce(p_round_order, 0), 0);
begin
  perform public.fantasy_vbf_require_admin();

  if v_round_key is null then
    raise exception 'La jornada no tiene round_key valido.';
  end if;

  insert into public.fantasy_vbf_rounds (season, round_key, round_label, round_order, rewards_applied)
  values (v_season, v_round_key, coalesce(nullif(v_round_label, ''), v_round_key), v_round_order, false)
  on conflict (season, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        updated_at = timezone('utc', now());

  update public.fantasy_vbf_seasons
  set is_open = false,
      current_round_key = v_round_key,
      current_round_label = coalesce(nullif(v_round_label, ''), v_round_key),
      current_round_order = v_round_order
  where season = v_season;

  insert into public.fantasy_vbf_team_rounds (
    season, team_id, user_id, round_key, round_label, round_order,
    weekly_points, weekly_rank, reward_coins, transfers_used, captain_changes_used
  )
  select
    v_season,
    t.id,
    t.user_id,
    v_round_key,
    coalesce(nullif(v_round_label, ''), v_round_key),
    v_round_order,
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
    'locked', true
  );
end;
$$;

create or replace function public.fantasy_vbf_unlock_round(
  p_season text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := upper(trim(coalesce(p_season, '')));
  v_cfg public.fantasy_vbf_seasons%rowtype;
begin
  perform public.fantasy_vbf_require_admin();

  select *
  into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;

  update public.fantasy_vbf_seasons
  set is_open = true
  where season = v_season;

  return jsonb_build_object(
    'season', v_season,
    'round_key', v_cfg.current_round_key,
    'unlocked', true,
    'market_open', true
  );
end;
$$;

create or replace function public.fantasy_vbf_capture_current_round_snapshot(
  p_season text,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := upper(trim(coalesce(p_season, '')));
  v_cfg public.fantasy_vbf_seasons%rowtype;
begin
  perform public.fantasy_vbf_require_admin();

  select *
  into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if nullif(v_cfg.current_round_key, '') is null then raise exception 'No hay jornada actual para capturar.'; end if;

  return public.fantasy_vbf_capture_round_snapshot(
    v_season,
    v_cfg.current_round_key,
    v_cfg.current_round_label,
    v_cfg.current_round_order,
    coalesce(p_force, false)
  );
end;
$$;

create or replace function public.fantasy_vbf_auto_lock_current_round(
  p_season text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := upper(trim(coalesce(p_season, '')));
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_snapshot jsonb := '{}'::jsonb;
begin
  -- Intended for a trusted Supabase scheduled job / pg_cron, not for direct client use.
  -- It is intentionally idempotent: repeated executions keep the market closed
  -- and only recreate the snapshot when it does not already exist.
  select *
  into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if nullif(v_cfg.current_round_key, '') is null then raise exception 'No hay jornada actual para bloquear.'; end if;

  v_snapshot := public.fantasy_vbf_capture_round_snapshot(
    v_season,
    v_cfg.current_round_key,
    v_cfg.current_round_label,
    v_cfg.current_round_order,
    false
  );

  update public.fantasy_vbf_seasons
  set is_open = false
  where season = v_season;

  return jsonb_build_object(
    'season', v_season,
    'round_key', v_cfg.current_round_key,
    'locked', true,
    'snapshot', v_snapshot,
    'source', 'auto'
  );
end;
$$;

create or replace function public.fantasy_vbf_process_current_round(
  p_season text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := upper(trim(coalesce(p_season, '')));
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_result jsonb;
begin
  perform public.fantasy_vbf_require_admin();

  select *
  into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if nullif(v_cfg.current_round_key, '') is null then raise exception 'No hay jornada actual para procesar.'; end if;

  v_result := public.fantasy_vbf_sync_round(
    v_season,
    v_cfg.current_round_key,
    v_cfg.current_round_label,
    v_cfg.current_round_order,
    '[]'::jsonb
  );

  update public.fantasy_vbf_seasons
  set is_open = true
  where season = v_season;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'season', v_season,
    'round_key', v_cfg.current_round_key,
    'processed', true,
    'market_open', true
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
  if v_cfg.is_open is not true or public.fantasy_vbf_market_is_open(now()) is not true then
    raise exception 'El mercado esta cerrado. No puedes cambiar capitan ahora.';
  end if;

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

grant execute on function public.fantasy_vbf_lock_round(text, text, text, integer) to authenticated;
grant execute on function public.fantasy_vbf_unlock_round(text) to authenticated;
grant execute on function public.fantasy_vbf_capture_current_round_snapshot(text, boolean) to authenticated;
grant execute on function public.fantasy_vbf_process_current_round(text) to authenticated;
grant execute on function public.fantasy_vbf_require_admin() to authenticated;
grant execute on function public.fantasy_vbf_save_lineup(text, jsonb, text) to authenticated;
grant execute on function public.fantasy_vbf_market_is_open(timestamptz) to anon, authenticated;

-- Optional Supabase scheduled job / pg_cron idea:
-- select public.fantasy_vbf_auto_lock_current_round('OP15');
-- Run it at the planned lineup deadline, for example Saturday 00:00 Europe/Madrid.
-- Supabase cron usually runs in UTC, so adjust for Europe/Madrid daylight saving time.
-- Example while Madrid is UTC+2:
-- select cron.schedule(
--   'fantasy-op15-lock-snapshot',
--   '0 22 * * 5',
--   $$select public.fantasy_vbf_auto_lock_current_round('OP15');$$
-- );
-- Do not grant this function to clients.
