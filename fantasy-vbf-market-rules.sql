-- Fantasy OP15 - market integrity rules and office replacements.
-- Apply after fantasy-vbf-schema.sql, fantasy-vbf-roster-snapshots.sql,
-- fantasy-vbf-weekly-admin.sql and fantasy-vbf-weekly-attendance.sql.

alter table public.fantasy_vbf_seasons
  add column if not exists min_roster_size integer not null default 1,
  add column if not exists market_economy_locked boolean not null default false,
  add column if not exists max_weekly_clause_buyouts_made integer not null default 1,
  add column if not exists max_weekly_clause_buyouts_received integer not null default 2,
  add column if not exists buy_protection_hours integer not null default 4,
  add column if not exists clause_protection_hours integer not null default 24,
  add column if not exists replacement_points_multiplier numeric(4,2) not null default 0.5;

alter table public.fantasy_vbf_roster_players
  add column if not exists lineup_slot text not null default 'active',
  add column if not exists protected_until timestamptz,
  add column if not exists protection_reason text;

alter table public.fantasy_vbf_roster_snapshots
  add column if not exists lineup_slot text not null default 'active',
  add column if not exists snapshot_source text not null default 'roster',
  add column if not exists points_multiplier numeric(4,2) not null default 1,
  add column if not exists is_captain boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fantasy_vbf_seasons_min_roster_size_chk') then
    alter table public.fantasy_vbf_seasons
      add constraint fantasy_vbf_seasons_min_roster_size_chk check (min_roster_size between 1 and squad_size);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fantasy_vbf_seasons_clause_limits_chk') then
    alter table public.fantasy_vbf_seasons
      add constraint fantasy_vbf_seasons_clause_limits_chk check (
        max_weekly_clause_buyouts_made between 0 and 20
        and max_weekly_clause_buyouts_received between 0 and 20
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fantasy_vbf_seasons_protection_hours_chk') then
    alter table public.fantasy_vbf_seasons
      add constraint fantasy_vbf_seasons_protection_hours_chk check (
        buy_protection_hours between 0 and 168
        and clause_protection_hours between 0 and 168
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fantasy_vbf_seasons_replacement_multiplier_chk') then
    alter table public.fantasy_vbf_seasons
      add constraint fantasy_vbf_seasons_replacement_multiplier_chk check (replacement_points_multiplier between 0 and 1);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fantasy_vbf_roster_protection_reason_chk') then
    alter table public.fantasy_vbf_roster_players
      add constraint fantasy_vbf_roster_protection_reason_chk check (
        protection_reason is null or protection_reason in ('market_buy', 'clause_buyout')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fantasy_vbf_roster_lineup_slot_chk') then
    alter table public.fantasy_vbf_roster_players
      add constraint fantasy_vbf_roster_lineup_slot_chk check (lineup_slot in ('active', 'bench'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fantasy_vbf_snapshot_lineup_slot_chk') then
    alter table public.fantasy_vbf_roster_snapshots
      add constraint fantasy_vbf_snapshot_lineup_slot_chk check (lineup_slot in ('active', 'bench'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fantasy_vbf_snapshot_source_chk') then
    alter table public.fantasy_vbf_roster_snapshots
      add constraint fantasy_vbf_snapshot_source_chk check (snapshot_source in ('roster', 'replacement'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fantasy_vbf_snapshot_multiplier_chk') then
    alter table public.fantasy_vbf_roster_snapshots
      add constraint fantasy_vbf_snapshot_multiplier_chk check (points_multiplier between 0 and 2);
  end if;
end;
$$;

create index if not exists fantasy_vbf_roster_protected_idx
  on public.fantasy_vbf_roster_players (season, player_slug, protected_until)
  where protected_until is not null;

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
  v_now timestamptz := timezone('utc', now());
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_team public.fantasy_vbf_teams%rowtype;
  v_pool public.fantasy_vbf_player_pool%rowtype;
  v_outgoing public.fantasy_vbf_roster_players%rowtype;
  v_target public.fantasy_vbf_roster_players%rowtype;
  v_round public.fantasy_vbf_team_rounds%rowtype;
  v_roster_count integer := 0;
  v_seller_roster_count integer := 0;
  v_copy_count integer := 0;
  v_buy_cost integer := 0;
  v_clause_made integer := 0;
  v_clause_received integer := 0;
begin
  if v_user is null then raise exception 'Debes iniciar sesion para fichar.'; end if;
  if v_slug = '' then raise exception 'Jugador invalido.'; end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

  if not found then raise exception 'La temporada fantasy no existe.'; end if;
  if v_cfg.is_open is not true then raise exception 'El mercado fantasy esta cerrado.'; end if;
  if coalesce(v_cfg.market_economy_locked, false) is true then raise exception 'La compraventa fantasy esta cerrada. Solo se pueden cambiar capitan y suplente.'; end if;
  if public.fantasy_vbf_market_is_open(now()) is not true then
    raise exception 'El mercado esta cerrado ahora mismo.';
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
      buy_price, clause_price, acquisition_type, acquired_round_key, protected_until, protection_reason
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
      v_round_key,
      case when coalesce(v_cfg.buy_protection_hours, 0) > 0 then v_now + make_interval(hours => v_cfg.buy_protection_hours) else null end,
      case when coalesce(v_cfg.buy_protection_hours, 0) > 0 then 'market_buy' else null end
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

    update public.fantasy_vbf_teams t
    set captain_player_slug = best.player_slug
    from (
      select rp.team_id, rp.player_slug
      from public.fantasy_vbf_roster_players rp
      join public.fantasy_vbf_player_pool pp on pp.season = rp.season and pp.player_slug = rp.player_slug
      where rp.team_id = v_team.id
      order by pp.current_price desc, rp.player_rank asc, rp.created_at asc
      limit 1
    ) best
    where t.id = best.team_id
      and not exists (
        select 1 from public.fantasy_vbf_roster_players rp
        where rp.team_id = t.id and rp.player_slug = t.captain_player_slug
      );

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

  select count(*) into v_clause_made
  from public.fantasy_vbf_transactions
  where season = v_season
    and round_key = v_round_key
    and team_id = v_team.id
    and tx_type = 'clause_in';

  if v_clause_made >= coalesce(v_cfg.max_weekly_clause_buyouts_made, 1) then
    raise exception 'Ya has usado tu clausulazo de esta jornada.';
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

  if v_target.protected_until is not null and v_target.protected_until > v_now then
    raise exception 'Este jugador esta protegido hasta %.', to_char(v_target.protected_until at time zone 'Europe/Madrid', 'DD/MM HH24:MI');
  end if;

  select count(*) into v_seller_roster_count
  from public.fantasy_vbf_roster_players
  where team_id = v_target.team_id;

  if v_seller_roster_count <= coalesce(v_cfg.min_roster_size, 1) then
    raise exception 'No puedes dejar a ese manager sin su plantilla minima.';
  end if;

  select count(*) into v_clause_received
  from public.fantasy_vbf_transactions
  where season = v_season
    and round_key = v_round_key
    and team_id = v_target.team_id
    and tx_type = 'clause_out';

  if v_clause_received >= coalesce(v_cfg.max_weekly_clause_buyouts_received, 2) then
    raise exception 'Ese manager ya ha recibido el maximo de clausulazos esta jornada.';
  end if;

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
      protected_until = case when coalesce(v_cfg.clause_protection_hours, 0) > 0 then v_now + make_interval(hours => v_cfg.clause_protection_hours) else null end,
      protection_reason = case when coalesce(v_cfg.clause_protection_hours, 0) > 0 then 'clause_buyout' else null end,
      created_at = v_now
  where id = v_target.id;

  update public.fantasy_vbf_teams t
  set captain_player_slug = best.player_slug
  from (
    select rp.team_id, rp.player_slug
    from public.fantasy_vbf_roster_players rp
    join public.fantasy_vbf_player_pool pp on pp.season = rp.season and pp.player_slug = rp.player_slug
    where rp.team_id = v_target.team_id
    order by pp.current_price desc, rp.player_rank asc, rp.created_at asc
    limit 1
  ) best
  where t.id = best.team_id
    and not exists (
      select 1 from public.fantasy_vbf_roster_players rp
      where rp.team_id = t.id and rp.player_slug = t.captain_player_slug
    );

  update public.fantasy_vbf_teams t
  set captain_player_slug = best.player_slug
  from (
    select rp.team_id, rp.player_slug
    from public.fantasy_vbf_roster_players rp
    join public.fantasy_vbf_player_pool pp on pp.season = rp.season and pp.player_slug = rp.player_slug
    where rp.team_id = v_team.id
    order by pp.current_price desc, rp.player_rank asc, rp.created_at asc
    limit 1
  ) best
  where t.id = best.team_id
    and not exists (
      select 1 from public.fantasy_vbf_roster_players rp
      where rp.team_id = t.id and rp.player_slug = t.captain_player_slug
    );

  insert into public.fantasy_vbf_transactions (
    season, round_key, team_id, user_id, player_slug, player_name, tx_type, amount, counts_as_transfer
  )
  values
    (v_season, v_round_key, v_team.id, v_user, v_pool.player_slug, v_pool.player_name, 'clause_in', v_buy_cost, true),
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
      format('Has pagado %s berries y ya ocupa una plaza en tu plantilla. Tiene proteccion temporal.', v_buy_cost),
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
      select 1 from public.fantasy_vbf_roster_players rp
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
      and not exists (
        select 1 from public.fantasy_vbf_roster_players owned
        where owned.team_id = team.id and owned.player_slug = team.captain_player_slug
      )
    order by rp.team_id, pp.current_price desc, rp.player_rank asc, rp.created_at asc
  ) best
  where t.id = best.team_id;

  insert into public.fantasy_vbf_roster_snapshots (
    season, round_key, round_label, round_order,
    team_id, user_id, player_slug, player_name, player_tier, player_rank,
    buy_price, clause_price, snapshot_source, points_multiplier, is_captain
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
    rp.player_slug = t.captain_player_slug
  from public.fantasy_vbf_roster_players rp
  join public.fantasy_vbf_teams t
    on t.id = rp.team_id and t.season = rp.season
  where rp.season = v_season;

  get diagnostics v_inserted = row_count;

  insert into public.fantasy_vbf_roster_snapshots (
    season, round_key, round_label, round_order,
    team_id, user_id, player_slug, player_name, player_tier, player_rank,
    buy_price, clause_price, snapshot_source, points_multiplier, is_captain
  )
  with team_needs as (
    select
      t.id as team_id,
      t.user_id,
      greatest(coalesce(v_cfg.squad_size, 3) - count(rp.id), 0) as missing
    from public.fantasy_vbf_teams t
    left join public.fantasy_vbf_roster_players rp on rp.team_id = t.id
    where t.season = v_season
    group by t.id, t.user_id
    having greatest(coalesce(v_cfg.squad_size, 3) - count(rp.id), 0) > 0
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
      end as replacement_priority,
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
    false
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
    having count(rs.id) < coalesce(v_cfg.squad_size, 3)
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
  v_cfg public.fantasy_vbf_seasons%rowtype;
  v_rewards_applied boolean := false;
  v_snapshot_count integer := 0;
  v_pool_ready integer := 0;
  v_missing_rewards integer := 0;
  v_row record;
  v_reward integer := 0;
  v_reward_delta integer := 0;
begin
  if v_user is null and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Debes iniciar sesion o ejecutar esta funcion desde backend para sincronizar.';
  end if;
  if v_round_key is null then
    raise exception 'La jornada no tiene week_key valido.';
  end if;

  select * into v_cfg
  from public.fantasy_vbf_seasons
  where season = v_season
  for update;

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
        coalesce(pp.current_fantasy_points, 0)
        * greatest(coalesce(rs.points_multiplier, 1), 0)
        * case when coalesce(rs.is_captain, false) then greatest(coalesce(v_cfg.captain_multiplier, 1), 1) else 1 end
      ) as weekly_points
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

  select count(*)
  into v_missing_rewards
  from public.fantasy_vbf_team_rounds tr
  where tr.season = v_season
    and tr.round_key = v_round_key
    and greatest(round(coalesce(tr.weekly_points, 0) * 1000)::integer, 0) > (
      select coalesce(sum(tx.amount), 0)
      from public.fantasy_vbf_transactions tx
      where tx.season = tr.season
        and tx.round_key = tr.round_key
        and tx.team_id = tr.team_id
        and tx.tx_type = 'system_reward'
    );

  if coalesce(v_rewards_applied, false) is false or v_missing_rewards > 0 then
    for v_row in
      select
        tr.team_id,
        tr.user_id,
        tr.weekly_points,
        greatest(round(coalesce(tr.weekly_points, 0) * 1000)::integer, 0) as expected_reward,
        (
          select coalesce(sum(tx.amount), 0)
          from public.fantasy_vbf_transactions tx
          where tx.season = tr.season
            and tx.round_key = tr.round_key
            and tx.team_id = tr.team_id
            and tx.tx_type = 'system_reward'
        ) as paid_reward
      from public.fantasy_vbf_team_rounds tr
      where tr.season = v_season and tr.round_key = v_round_key
    loop
      v_reward := greatest(coalesce(v_row.expected_reward, 0), 0);
      v_reward_delta := greatest(v_reward - greatest(coalesce(v_row.paid_reward, 0), 0), 0);

      update public.fantasy_vbf_teams
      set coins = coins + v_reward_delta
      where id = v_row.team_id
        and v_reward_delta > 0;

      update public.fantasy_vbf_team_rounds
      set reward_coins = v_reward
      where season = v_season and round_key = v_round_key and team_id = v_row.team_id;

      if v_reward_delta > 0 then
        insert into public.fantasy_vbf_transactions (
          season, round_key, team_id, user_id, player_slug, player_name, tx_type, amount, counts_as_transfer
        )
        values (
          v_season, v_round_key, v_row.team_id, v_row.user_id,
          null, null, 'system_reward', v_reward_delta, false
        );

        insert into public.fantasy_vbf_notifications (season, user_id, team_id, kind, title, body, payload)
        values (
          v_season,
          v_row.user_id,
          v_row.team_id,
          'weekly_reward',
          format('Recompensa aplicada en %s', v_round_label),
          format('Has recibido %s berries por el rendimiento de tu plantilla en la jornada.', v_reward_delta),
          jsonb_build_object('round_key', v_round_key, 'reward', v_reward_delta, 'weekly_points', v_row.weekly_points)
        );
      end if;
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

create or replace function public.fantasy_vbf_reset_after_round(
  p_season text,
  p_keep_round_key text,
  p_reset_coins boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season text := upper(trim(coalesce(p_season, '')));
  v_keep_round_key text := nullif(trim(coalesce(p_keep_round_key, '')), '');
  v_keep_round public.fantasy_vbf_rounds%rowtype;
  v_future_rounds integer := 0;
  v_deleted_snapshots integer := 0;
  v_deleted_team_rounds integer := 0;
  v_deleted_rounds integer := 0;
  v_deleted_transactions integer := 0;
  v_deleted_notifications integer := 0;
  v_reset_teams integer := 0;
begin
  if auth.uid() is not null or current_user not in ('postgres', 'supabase_admin') then
    perform public.fantasy_vbf_require_admin();
  end if;

  if v_keep_round_key is null then
    raise exception 'Debes indicar la jornada hasta la que quieres conservar.';
  end if;

  select *
  into v_keep_round
  from public.fantasy_vbf_rounds
  where season = v_season
    and round_key = v_keep_round_key;

  if not found then
    raise exception 'No existe la jornada % en la temporada %.', v_keep_round_key, v_season;
  end if;

  drop table if exists fantasy_vbf_tmp_reset_rounds;
  create temporary table fantasy_vbf_tmp_reset_rounds (
    round_key text primary key
  ) on commit drop;

  insert into fantasy_vbf_tmp_reset_rounds (round_key)
  select round_key
  from public.fantasy_vbf_rounds
  where season = v_season
    and round_order > v_keep_round.round_order;

  get diagnostics v_future_rounds = row_count;

  delete from public.fantasy_vbf_notifications n
  where n.season = v_season
    and n.payload->>'round_key' in (
      select round_key from fantasy_vbf_tmp_reset_rounds
    );

  get diagnostics v_deleted_notifications = row_count;

  delete from public.fantasy_vbf_transactions tx
  where tx.season = v_season
    and tx.round_key in (
      select round_key from fantasy_vbf_tmp_reset_rounds
    );

  get diagnostics v_deleted_transactions = row_count;

  delete from public.fantasy_vbf_roster_snapshots rs
  where rs.season = v_season
    and rs.round_key in (
      select round_key from fantasy_vbf_tmp_reset_rounds
    );

  get diagnostics v_deleted_snapshots = row_count;

  delete from public.fantasy_vbf_team_rounds tr
  where tr.season = v_season
    and tr.round_key in (
      select round_key from fantasy_vbf_tmp_reset_rounds
    );

  get diagnostics v_deleted_team_rounds = row_count;

  delete from public.fantasy_vbf_rounds r
  where r.season = v_season
    and r.round_key in (
      select round_key from fantasy_vbf_tmp_reset_rounds
    );

  get diagnostics v_deleted_rounds = row_count;

  update public.fantasy_vbf_teams t
  set total_points = coalesce((
    select sum(tr.weekly_points)
    from public.fantasy_vbf_team_rounds tr
    where tr.season = v_season
      and tr.team_id = t.id
  ), 0)
  where t.season = v_season;

  if coalesce(p_reset_coins, false) then
    update public.fantasy_vbf_teams t
    set coins = coalesce(s.budget, t.coins)
    from public.fantasy_vbf_seasons s
    where t.season = v_season
      and s.season = t.season;

    get diagnostics v_reset_teams = row_count;
  end if;

  update public.fantasy_vbf_seasons
  set is_open = true,
      market_economy_locked = false,
      current_round_key = v_keep_round.round_key,
      current_round_label = v_keep_round.round_label,
      current_round_order = v_keep_round.round_order
  where season = v_season;

  return jsonb_build_object(
    'season', v_season,
    'kept_round_key', v_keep_round.round_key,
    'kept_round_label', v_keep_round.round_label,
    'future_rounds', v_future_rounds,
    'deleted_rounds', v_deleted_rounds,
    'deleted_snapshots', v_deleted_snapshots,
    'deleted_team_rounds', v_deleted_team_rounds,
    'deleted_transactions', v_deleted_transactions,
    'deleted_notifications', v_deleted_notifications,
    'coins_reset', coalesce(p_reset_coins, false),
    'teams_reset', v_reset_teams,
    'market_open', true
  );
end;
$$;

grant execute on function public.fantasy_vbf_buy_player(text, text, text, text, uuid) to authenticated;
grant execute on function public.fantasy_vbf_capture_round_snapshot(text, text, text, integer, boolean) to authenticated;
grant execute on function public.fantasy_vbf_sync_round(text, text, text, integer, jsonb) to authenticated;
grant execute on function public.fantasy_vbf_reset_after_round(text, text, boolean) to authenticated;
