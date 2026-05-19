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
  with local_now as (
    select timezone('Europe/Madrid', coalesce(p_now, now())) as ts
  )
  select extract(isodow from ts)::integer between 1 and 5
    and not (
      extract(isodow from ts)::integer = 5
      and ts::time >= time '19:00'
    )
  from local_now
$$;

create or replace function public.fantasy_vbf_lineup_is_open(p_now timestamptz default now())
returns boolean
language sql
stable
as $$
  select extract(isodow from timezone('Europe/Madrid', coalesce(p_now, now())))::integer between 1 and 5
$$;

alter table public.fantasy_vbf_seasons
  add column if not exists market_economy_locked boolean not null default false;

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
      market_economy_locked = true,
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
  set is_open = true,
      market_economy_locked = false
  where season = v_season;

  return jsonb_build_object(
    'season', v_season,
    'round_key', v_cfg.current_round_key,
    'unlocked', true,
    'market_open', true
  );
end;
$$;

create or replace function public.fantasy_vbf_lock_market_economy(
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
  set is_open = true,
      market_economy_locked = true,
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
    'economy_locked', true,
    'lineup_open', true
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
begin
  select *
  into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if nullif(v_cfg.current_round_key, '') is null then raise exception 'No hay jornada actual para bloquear automaticamente.'; end if;

  insert into public.fantasy_vbf_rounds (season, round_key, round_label, round_order, rewards_applied)
  values (
    v_season,
    v_cfg.current_round_key,
    coalesce(nullif(v_cfg.current_round_label, ''), v_cfg.current_round_key),
    coalesce(v_cfg.current_round_order, 0),
    false
  )
  on conflict (season, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        updated_at = timezone('utc', now());

  update public.fantasy_vbf_seasons
  set is_open = false,
      market_economy_locked = true
  where season = v_season;

  insert into public.fantasy_vbf_team_rounds (
    season, team_id, user_id, round_key, round_label, round_order,
    weekly_points, weekly_rank, reward_coins, transfers_used, captain_changes_used
  )
  select
    v_season,
    t.id,
    t.user_id,
    v_cfg.current_round_key,
    coalesce(nullif(v_cfg.current_round_label, ''), v_cfg.current_round_key),
    coalesce(v_cfg.current_round_order, 0),
    0, null, 0, 0, 0
  from public.fantasy_vbf_teams t
  where t.season = v_season
  on conflict (season, team_id, round_key) do update
    set round_label = excluded.round_label,
        round_order = excluded.round_order,
        synced_at = timezone('utc', now());

  return jsonb_build_object(
    'season', v_season,
    'round_key', v_cfg.current_round_key,
    'locked', true,
    'automatic', true
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

create or replace function public.fantasy_vbf_auto_capture_current_round_snapshot(
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
  select *
  into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if nullif(v_cfg.current_round_key, '') is null then raise exception 'No hay jornada actual para capturar automaticamente.'; end if;

  return public.fantasy_vbf_capture_round_snapshot(
    v_season,
    v_cfg.current_round_key,
    coalesce(nullif(v_cfg.current_round_label, ''), v_cfg.current_round_key),
    coalesce(v_cfg.current_round_order, 0),
    coalesce(p_force, false)
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
  set is_open = true,
      market_economy_locked = false
  where season = v_season;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'season', v_season,
    'round_key', v_cfg.current_round_key,
    'processed', true,
    'market_open', true
  );
end;
$$;

grant execute on function public.fantasy_vbf_lock_round(text, text, text, integer) to authenticated;
grant execute on function public.fantasy_vbf_lock_market_economy(text, text, text, integer) to authenticated;
grant execute on function public.fantasy_vbf_unlock_round(text) to authenticated;
grant execute on function public.fantasy_vbf_capture_current_round_snapshot(text, boolean) to authenticated;
grant execute on function public.fantasy_vbf_process_current_round(text) to authenticated;
grant execute on function public.fantasy_vbf_require_admin() to authenticated;
grant execute on function public.fantasy_vbf_market_is_open(timestamptz) to anon, authenticated;
grant execute on function public.fantasy_vbf_lineup_is_open(timestamptz) to anon, authenticated;
revoke execute on function public.fantasy_vbf_auto_lock_current_round(text) from public, anon, authenticated;
revoke execute on function public.fantasy_vbf_auto_capture_current_round_snapshot(text, boolean) from public, anon, authenticated;

-- Optional Supabase scheduled job / pg_cron idea:
-- select public.fantasy_vbf_auto_lock_current_round('OP15');
-- select public.fantasy_vbf_auto_capture_current_round_snapshot('OP15', false);
-- Run them at Saturday 00:00 and 00:30 Europe/Madrid.
-- Supabase cron usually runs in UTC, so adjust for Europe/Madrid daylight saving time.
-- Example while Madrid is UTC+2:
-- select cron.schedule(
--   'fantasy-op15-auto-lock',
--   '0 22 * * 5',
--   $$select public.fantasy_vbf_auto_lock_current_round('OP15');$$
-- );
-- select cron.schedule(
--   'fantasy-op15-auto-snapshot',
--   '30 22 * * 5',
--   $$select public.fantasy_vbf_auto_capture_current_round_snapshot('OP15', false);$$
-- );
-- Do not grant this function to clients.

notify pgrst, 'reload schema';
