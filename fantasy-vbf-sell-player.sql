-- Fantasy OP15 - manual player sales.
-- Apply after fantasy-vbf-schema.sql and fantasy-vbf-market-rules.sql.

alter table public.fantasy_vbf_seasons
  add column if not exists market_economy_locked boolean not null default false;

drop function if exists public.fantasy_vbf_sell_player(text, text, text, integer);
drop function if exists public.fantasy_vbf_sell_player(text, text, text);

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
  if coalesce(v_cfg.market_economy_locked, false) is true then raise exception 'La compraventa fantasy esta cerrada. Solo se pueden cambiar capitan y suplente.'; end if;
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

grant execute on function public.fantasy_vbf_sell_player(text, text, text, integer) to authenticated;

notify pgrst, 'reload schema';
