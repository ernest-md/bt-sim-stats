-- Server-side dataset for team stats.
-- This keeps the team page aligned with SQL results from Supabase instead of
-- relying on client-side fan-out queries over players + matches.

drop function if exists public.get_team_stats_matches_v1(text, timestamptz, timestamptz);

create or replace function public.get_team_stats_matches_v1(
  p_team text,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null
)
returns table (
  match_id uuid,
  player_id uuid,
  profile_id uuid,
  player_name text,
  profile_username text,
  profile_display_name text,
  profile_team text,
  player_leader text,
  opponent_leader text,
  result text,
  match_date timestamptz,
  turn_order int,
  player_leader_code text,
  player_leader_name text,
  player_leader_image_url text,
  player_leader_parallel_image_url text,
  opponent_leader_code text,
  opponent_leader_name text,
  opponent_leader_image_url text,
  opponent_leader_parallel_image_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team text := upper(trim(coalesce(p_team, '')));
  v_viewer_team text := '';
  v_viewer_role text := 'user';
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select
    upper(trim(coalesce(team, ''))),
    lower(trim(coalesce(app_role, 'user')))
  into
    v_viewer_team,
    v_viewer_role
  from public.profiles
  where id = auth.uid();

  if coalesce(v_viewer_role, 'user') not in ('admin', 'staff', 'vdj') then
    if v_team = '' or v_team = 'SIN EQUIPO' then
      raise exception 'Invalid team';
    end if;
    if coalesce(v_viewer_team, '') <> v_team then
      raise exception 'Forbidden team';
    end if;
  end if;

  return query
  select
    m.id as match_id,
    m.player_id,
    p.profile_id,
    p.name as player_name,
    pr.username as profile_username,
    pr.display_name as profile_display_name,
    coalesce(pr.team, 'SIN EQUIPO') as profile_team,
    m.player_leader,
    m.opponent_leader,
    m.result,
    m.match_date,
    m.turn_order,
    coalesce(lp.code, m.player_leader) as player_leader_code,
    coalesce(lp.name, m.player_leader) as player_leader_name,
    coalesce(lp.image_url, '') as player_leader_image_url,
    coalesce(lp.parallel_image_url, '') as player_leader_parallel_image_url,
    coalesce(lo.code, m.opponent_leader) as opponent_leader_code,
    coalesce(lo.name, m.opponent_leader) as opponent_leader_name,
    coalesce(lo.image_url, '') as opponent_leader_image_url,
    coalesce(lo.parallel_image_url, '') as opponent_leader_parallel_image_url
  from public.matches m
  join public.players p on p.id = m.player_id
  join public.profiles pr on pr.id = p.profile_id
  left join public.leaders lp on lp.code = m.player_leader
  left join public.leaders lo on lo.code = m.opponent_leader
  where upper(trim(coalesce(pr.team, ''))) = v_team
    and (p_start_at is null or m.match_date >= p_start_at)
    and (p_end_at is null or m.match_date <= p_end_at)
  order by m.match_date desc, m.id desc;
end;
$$;

revoke all on function public.get_team_stats_matches_v1(text, timestamptz, timestamptz) from public;
grant execute on function public.get_team_stats_matches_v1(text, timestamptz, timestamptz) to authenticated;
