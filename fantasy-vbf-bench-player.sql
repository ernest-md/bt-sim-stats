-- Fantasy OP15 - cuarto jugador suplente.
-- Apply after fantasy-vbf-market-rules.sql.

alter table public.fantasy_vbf_seasons
  alter column squad_size set default 4;

alter table public.fantasy_vbf_seasons
  add column if not exists market_economy_locked boolean not null default false;

update public.fantasy_vbf_seasons
set squad_size = greatest(squad_size, 4),
    starter_size = 3,
    starter_pack_size = 3
where season = 'OP15';

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

alter table public.fantasy_vbf_roster_players
  add column if not exists lineup_slot text not null default 'active';

alter table public.fantasy_vbf_roster_snapshots
  add column if not exists lineup_slot text not null default 'active';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fantasy_vbf_roster_lineup_slot_chk') then
    alter table public.fantasy_vbf_roster_players
      add constraint fantasy_vbf_roster_lineup_slot_chk check (lineup_slot in ('active', 'bench'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fantasy_vbf_snapshot_lineup_slot_chk') then
    alter table public.fantasy_vbf_roster_snapshots
      add constraint fantasy_vbf_snapshot_lineup_slot_chk check (lineup_slot in ('active', 'bench'));
  end if;
end;
$$;

create unique index if not exists fantasy_vbf_roster_one_bench_idx
  on public.fantasy_vbf_roster_players (season, team_id)
  where lineup_slot = 'bench';

create or replace function public.fantasy_vbf_pick_lineup_slot(
  p_season text,
  p_team_id uuid
)
returns text
language sql
stable
as $$
  select case
    when (
      select count(*)
      from public.fantasy_vbf_roster_players rp
      where rp.season = p_season
        and rp.team_id = p_team_id
        and coalesce(rp.lineup_slot, 'active') = 'active'
    ) >= (
      select greatest(coalesce(starter_size, 3), 1)
      from public.fantasy_vbf_seasons
      where season = p_season
    )
    then 'bench'
    else 'active'
  end
$$;

create or replace function public.fantasy_vbf_roster_lineup_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.lineup_slot := public.fantasy_vbf_pick_lineup_slot(new.season, new.team_id);
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.team_id is distinct from old.team_id or new.user_id is distinct from old.user_id) then
    new.lineup_slot := public.fantasy_vbf_pick_lineup_slot(new.season, new.team_id);
    return new;
  end if;

  if tg_op = 'UPDATE' and coalesce(new.lineup_slot, 'active') not in ('active', 'bench') then
    new.lineup_slot := 'active';
  end if;

  return new;
end;
$$;

drop trigger if exists fantasy_vbf_roster_lineup_guard on public.fantasy_vbf_roster_players;
create trigger fantasy_vbf_roster_lineup_guard
before insert or update on public.fantasy_vbf_roster_players
for each row execute function public.fantasy_vbf_roster_lineup_guard();

create or replace function public.fantasy_vbf_fix_team_lineup(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.fantasy_vbf_teams%rowtype;
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_active_count integer := 0;
  v_extra record;
begin
  if p_team_id is null then return; end if;

  select * into v_team
  from public.fantasy_vbf_teams
  where id = p_team_id;
  if not found then return; end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_team.season;
  if not found then return; end if;

  select count(*) into v_active_count
  from public.fantasy_vbf_roster_players
  where team_id = p_team_id
    and lineup_slot = 'active';

  for v_extra in
    select rp.id
    from public.fantasy_vbf_roster_players rp
    join public.fantasy_vbf_player_pool pp on pp.season = rp.season and pp.player_slug = rp.player_slug
    where rp.team_id = p_team_id
      and rp.lineup_slot = 'bench'
      and v_active_count < greatest(coalesce(v_cfg.starter_size, 3), 1)
    order by pp.current_price desc, rp.player_rank asc, rp.created_at asc
  loop
    update public.fantasy_vbf_roster_players
    set lineup_slot = 'active'
    where id = v_extra.id;

    v_active_count := v_active_count + 1;
  end loop;

  for v_extra in
    select rp.id
    from public.fantasy_vbf_roster_players rp
    join public.fantasy_vbf_player_pool pp on pp.season = rp.season and pp.player_slug = rp.player_slug
    where rp.team_id = p_team_id
      and rp.lineup_slot = 'active'
    order by pp.current_price asc, rp.player_rank desc, rp.created_at desc
    offset greatest(coalesce(v_cfg.starter_size, 3), 1)
  loop
    update public.fantasy_vbf_roster_players
    set lineup_slot = 'bench'
    where id = v_extra.id;
  end loop;

  update public.fantasy_vbf_teams t
  set captain_player_slug = best.player_slug,
      updated_at = timezone('utc', now())
  from (
    select rp.team_id, rp.player_slug
    from public.fantasy_vbf_roster_players rp
    join public.fantasy_vbf_player_pool pp on pp.season = rp.season and pp.player_slug = rp.player_slug
    where rp.team_id = p_team_id
      and rp.lineup_slot = 'active'
    order by pp.current_price desc, rp.player_rank asc, rp.created_at asc
    limit 1
  ) best
  where t.id = best.team_id
    and not exists (
      select 1
      from public.fantasy_vbf_roster_players rp
      where rp.team_id = t.id
        and rp.player_slug = t.captain_player_slug
        and rp.lineup_slot = 'active'
    );

  update public.fantasy_vbf_teams t
  set captain_player_slug = null,
      updated_at = timezone('utc', now())
  where t.id = p_team_id
    and not exists (
      select 1
      from public.fantasy_vbf_roster_players rp
      where rp.team_id = t.id
        and rp.lineup_slot = 'active'
    );
end;
$$;

create or replace function public.fantasy_vbf_roster_lineup_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('fantasy_vbf.skip_lineup_fix', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.fantasy_vbf_fix_team_lineup(old.team_id);
    return old;
  end if;

  perform public.fantasy_vbf_fix_team_lineup(new.team_id);
  if tg_op = 'UPDATE' and old.team_id is distinct from new.team_id then
    perform public.fantasy_vbf_fix_team_lineup(old.team_id);
  end if;
  return new;
end;
$$;

drop trigger if exists fantasy_vbf_roster_lineup_after on public.fantasy_vbf_roster_players;
create trigger fantasy_vbf_roster_lineup_after
after insert or update or delete on public.fantasy_vbf_roster_players
for each row execute function public.fantasy_vbf_roster_lineup_after();

create or replace function public.fantasy_vbf_set_bench_player(
  p_season text,
  p_bench_player_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := upper(trim(coalesce(p_season, '')));
  v_slug text := trim(coalesce(p_bench_player_slug, ''));
  v_team public.fantasy_vbf_teams%rowtype;
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_roster_count integer := 0;
begin
  if v_user is null then raise exception 'Debes iniciar sesion para cambiar el suplente.'; end if;
  if v_slug = '' then raise exception 'Jugador suplente invalido.'; end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if v_cfg.is_open is not true or public.fantasy_vbf_lineup_is_open(now()) is not true then
    raise exception 'Los cambios de plantilla estan cerrados. No puedes cambiar el suplente ahora.';
  end if;

  select * into v_team
  from public.fantasy_vbf_teams
  where season = v_season and user_id = v_user
  for update;

  if not found then raise exception 'Primero debes crear tu equipo.'; end if;

  select count(*) into v_roster_count
  from public.fantasy_vbf_roster_players
  where team_id = v_team.id;

  if v_roster_count <= coalesce(v_cfg.starter_size, 3) then
    raise exception 'Necesitas tener un cuarto jugador para usar suplente.';
  end if;

  if not exists (
    select 1
    from public.fantasy_vbf_roster_players
    where team_id = v_team.id and player_slug = v_slug
  ) then
    raise exception 'Ese jugador no esta en tu plantilla.';
  end if;

  perform set_config('fantasy_vbf.skip_lineup_fix', '1', true);

  update public.fantasy_vbf_roster_players
  set lineup_slot = 'active'
  where team_id = v_team.id
    and lineup_slot <> 'active';

  update public.fantasy_vbf_roster_players
  set lineup_slot = 'bench'
  where team_id = v_team.id
    and player_slug = v_slug;

  perform set_config('fantasy_vbf.skip_lineup_fix', '0', true);
  perform public.fantasy_vbf_fix_team_lineup(v_team.id);

  return jsonb_build_object(
    'season', v_season,
    'team_id', v_team.id,
    'bench_player_slug', v_slug
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
  if v_cfg.is_open is not true or public.fantasy_vbf_lineup_is_open(now()) is not true then
    raise exception 'Los cambios de plantilla estan cerrados. No puedes cambiar capitan ahora.';
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
      raise exception 'La plantilla debe contener todos tus jugadores.';
    end if;
  end if;

  if v_captain is not null and not exists (
    select 1
    from public.fantasy_vbf_roster_players
    where team_id = v_team.id
      and player_slug = v_captain
      and lineup_slot = 'active'
  ) then
    raise exception 'El capitan debe ser un jugador activo, no el suplente.';
  end if;

  update public.fantasy_vbf_teams
  set captain_player_slug = v_captain
  where id = v_team.id;
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
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_existing integer := 0;
  v_inserted integer := 0;
  v_replacements integer := 0;
  v_incomplete_snapshots integer := 0;
  v_zero_team text := '';
begin
  if v_user is null and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Debes iniciar sesion o ejecutar esta funcion desde backend para congelar la plantilla.';
  end if;
  if v_round_key is null then
    raise exception 'La jornada no tiene round_key valido para congelar la plantilla.';
  end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;

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

  select t.team_name
  into v_zero_team
  from public.fantasy_vbf_teams t
  where t.season = v_season
    and not exists (
      select 1
      from public.fantasy_vbf_roster_players rp
      where rp.team_id = t.id
    )
  order by t.created_at asc
  limit 1;

  if found then
    raise exception 'El equipo % no tiene jugadores reales. No se puede capturar snapshot.', v_zero_team;
  end if;

  if coalesce(p_force, false) then
    delete from public.fantasy_vbf_roster_snapshots
    where season = v_season and round_key = v_round_key;
  end if;

  update public.fantasy_vbf_teams t
  set captain_player_slug = best.player_slug
  from (
    select distinct on (rp.team_id)
      rp.team_id,
      rp.player_slug
    from public.fantasy_vbf_roster_players rp
    join public.fantasy_vbf_player_pool pp on pp.season = rp.season and pp.player_slug = rp.player_slug
    join public.fantasy_vbf_teams team on team.id = rp.team_id
    where rp.season = v_season
      and rp.lineup_slot = 'active'
      and not exists (
        select 1
        from public.fantasy_vbf_roster_players owned
        where owned.team_id = team.id
          and owned.player_slug = team.captain_player_slug
          and owned.lineup_slot = 'active'
      )
    order by rp.team_id, pp.current_price desc, rp.player_rank asc, rp.created_at asc
  ) best
  where t.id = best.team_id;

  insert into public.fantasy_vbf_roster_snapshots (
    season, round_key, round_label, round_order,
    team_id, user_id, player_slug, player_name, player_tier, player_rank,
    buy_price, clause_price, snapshot_source, points_multiplier, is_captain, lineup_slot
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
    rp.clause_price,
    'roster',
    1,
    rp.player_slug = t.captain_player_slug,
    'active'
  from public.fantasy_vbf_roster_players rp
  join public.fantasy_vbf_teams t
    on t.id = rp.team_id and t.season = rp.season
  where rp.season = v_season
    and rp.lineup_slot = 'active';

  get diagnostics v_inserted = row_count;

  insert into public.fantasy_vbf_roster_snapshots (
    season, round_key, round_label, round_order,
    team_id, user_id, player_slug, player_name, player_tier, player_rank,
    buy_price, clause_price, snapshot_source, points_multiplier, is_captain, lineup_slot
  )
  with team_needs as (
    select
      t.id as team_id,
      t.user_id,
      greatest(coalesce(v_cfg.starter_size, 3) - count(rp.id), 0) as missing
    from public.fantasy_vbf_teams t
    left join public.fantasy_vbf_roster_players rp
      on rp.team_id = t.id
      and rp.lineup_slot = 'active'
    where t.season = v_season
    group by t.id, t.user_id
    having greatest(coalesce(v_cfg.starter_size, 3) - count(rp.id), 0) > 0
  ),
  recent_round_orders as (
    select distinct pr.round_order
    from public.fantasy_vbf_player_rounds pr
    where pr.season = v_season
      and pr.round_order < v_round_order
      and coalesce(pr.raw_points, 0) > 0
    order by pr.round_order desc
    limit 1
  ),
  candidates as (
    select
      tn.team_id,
      tn.user_id,
      pp.player_slug,
      pp.player_name,
      pp.player_tier,
      pp.player_rank,
      row_number() over (
        partition by tn.team_id
        order by
          case
            when exists (
              select 1
              from public.fantasy_vbf_weekly_attendance wa
              where wa.season = v_season
                and wa.round_key = v_round_key
                and wa.player_slug = pp.player_slug
                and wa.attending is true
            ) then 0
            else 1
          end asc,
          case
            when lower(trim(pp.player_tier)) in ('pirate king', 'yonkou') then 4
            when not exists (
              select 1
              from public.fantasy_vbf_player_rounds pr
              where pr.season = pp.season
                and pr.player_slug = pp.player_slug
                and pr.round_order in (select round_order from recent_round_orders)
                and coalesce(pr.raw_points, 0) > 0
            ) and exists (
              select 1
              from public.fantasy_vbf_roster_players any_owner
              where any_owner.season = v_season
                and any_owner.player_slug = pp.player_slug
            ) then 3
            when not exists (
              select 1
              from public.fantasy_vbf_player_rounds pr
              where pr.season = pp.season
                and pr.player_slug = pp.player_slug
                and pr.round_order in (select round_order from recent_round_orders)
                and coalesce(pr.raw_points, 0) > 0
            ) then 2
            when exists (
              select 1
              from public.fantasy_vbf_roster_players any_owner
              where any_owner.season = v_season
                and any_owner.player_slug = pp.player_slug
            ) then 1
            else 0
          end asc,
          pp.current_price asc,
          pp.player_rank desc,
          pp.player_slug asc
      ) as rn,
      tn.missing
    from team_needs tn
    join public.fantasy_vbf_player_pool pp on pp.season = v_season
    where not exists (
        select 1
        from public.fantasy_vbf_roster_players rp
        where rp.team_id = tn.team_id
          and rp.player_slug = pp.player_slug
      )
  )
  select
    v_season,
    v_round_key,
    v_round_label,
    v_round_order,
    c.team_id,
    c.user_id,
    c.player_slug,
    c.player_name,
    c.player_tier,
    c.player_rank,
    0,
    0,
    'replacement',
    coalesce(v_cfg.replacement_points_multiplier, 0.5),
    false,
    'active'
  from candidates c
  where c.rn <= c.missing;

  get diagnostics v_replacements = row_count;

  select count(*)
  into v_incomplete_snapshots
  from (
    select t.id, count(rs.id) as snapshot_players
    from public.fantasy_vbf_teams t
    left join public.fantasy_vbf_roster_snapshots rs
      on rs.team_id = t.id
      and rs.season = t.season
      and rs.round_key = v_round_key
    where t.season = v_season
    group by t.id
    having count(rs.id) < coalesce(v_cfg.starter_size, 3)
  ) missing;

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
    'players', v_inserted + v_replacements,
    'real_players', v_inserted,
    'replacement_players', v_replacements,
    'incomplete_teams', v_incomplete_snapshots
  );
end;
$$;

grant execute on function public.fantasy_vbf_set_bench_player(text, text) to authenticated;
grant execute on function public.fantasy_vbf_save_lineup(text, jsonb, text) to authenticated;
grant execute on function public.fantasy_vbf_pick_lineup_slot(text, uuid) to authenticated;
grant execute on function public.fantasy_vbf_market_is_open(timestamptz) to anon, authenticated;
grant execute on function public.fantasy_vbf_lineup_is_open(timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
