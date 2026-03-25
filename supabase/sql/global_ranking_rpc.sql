-- Global ranking dataset for ranking.html.
-- Exposes a shared ranking view to any authenticated user without reusing
-- the per-player SIM Stats RLS policies.
-- get_global_ranking_matches_v2 keeps the original ranking.html timestamp filtering
-- semantics so admin and non-admin users see the same numbers.

drop function if exists public.get_global_ranking_matches(timestamptz, timestamptz);
drop function if exists public.get_global_ranking_matches(date, date);

create or replace function public.get_global_ranking_matches(
  p_start_at date default null,
  p_end_at date default null
)
returns table (
  match_id uuid,
  player_id uuid,
  profile_id uuid,
  player_name text,
  profile_username text,
  profile_display_name text,
  profile_member boolean,
  player_leader text,
  result text,
  match_date timestamptz,
  leader_code text,
  leader_name text,
  leader_image_url text,
  leader_parallel_image_url text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    m.id as match_id,
    m.player_id,
    p.profile_id,
    p.name as player_name,
    pr.username as profile_username,
    pr.display_name as profile_display_name,
    coalesce(pr.member, false) as profile_member,
    m.player_leader,
    m.result,
    m.match_date,
    coalesce(l.code, m.player_leader) as leader_code,
    coalesce(l.name, m.player_leader) as leader_name,
    coalesce(l.image_url, '') as leader_image_url,
    coalesce(l.parallel_image_url, '') as leader_parallel_image_url
  from public.matches m
  join public.players p on p.id = m.player_id
  left join public.profiles pr on pr.id = p.profile_id
  left join public.leaders l on l.code = m.player_leader
  where coalesce(pr.member, false) = true
    and (p_start_at is null or timezone('Europe/Madrid', m.match_date)::date >= p_start_at)
    and (p_end_at is null or timezone('Europe/Madrid', m.match_date)::date <= p_end_at)
  order by m.match_date desc, m.id desc;
end;
$$;

revoke all on function public.get_global_ranking_matches(date, date) from public;
grant execute on function public.get_global_ranking_matches(date, date) to authenticated;

drop function if exists public.get_global_ranking_matches_v2(timestamptz, timestamptz);

create or replace function public.get_global_ranking_matches_v2(
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
  profile_member boolean,
  player_leader text,
  result text,
  match_date timestamptz,
  leader_code text,
  leader_name text,
  leader_image_url text,
  leader_parallel_image_url text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    m.id as match_id,
    m.player_id,
    p.profile_id,
    p.name as player_name,
    pr.username as profile_username,
    pr.display_name as profile_display_name,
    coalesce(pr.member, false) as profile_member,
    m.player_leader,
    m.result,
    m.match_date,
    coalesce(l.code, m.player_leader) as leader_code,
    coalesce(l.name, m.player_leader) as leader_name,
    coalesce(l.image_url, '') as leader_image_url,
    coalesce(l.parallel_image_url, '') as leader_parallel_image_url
  from public.matches m
  join public.players p on p.id = m.player_id
  left join public.profiles pr on pr.id = p.profile_id
  left join public.leaders l on l.code = m.player_leader
  where coalesce(pr.member, false) = true
    and (p_start_at is null or m.match_date >= p_start_at)
    and (p_end_at is null or m.match_date <= p_end_at)
  order by m.match_date desc, m.id desc;
end;
$$;

revoke all on function public.get_global_ranking_matches_v2(timestamptz, timestamptz) from public;
grant execute on function public.get_global_ranking_matches_v2(timestamptz, timestamptz) to authenticated;
