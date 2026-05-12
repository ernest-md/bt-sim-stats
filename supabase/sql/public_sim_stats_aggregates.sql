-- Public aggregate SIM stats.
-- These functions intentionally expose only summary stats, not matchup detail.

drop function if exists public.get_public_profile_expansion_stats_v1(uuid, timestamptz, timestamptz);

create or replace function public.get_public_profile_expansion_stats_v1(
  p_profile_id uuid,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null
)
returns table (
  leader_code text,
  leader_name text,
  leader_image_url text,
  leader_parallel_image_url text,
  games bigint,
  wins bigint
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(l.code, m.player_leader) as leader_code,
    coalesce(l.name, m.player_leader) as leader_name,
    coalesce(l.image_url, '') as leader_image_url,
    coalesce(l.parallel_image_url, '') as leader_parallel_image_url,
    count(*) as games,
    count(*) filter (where lower(trim(coalesce(m.result, ''))) in ('won', 'win', 'victoria', 'w')) as wins
  from public.matches m
  join public.players p on p.id = m.player_id
  left join public.leaders l on l.code = m.player_leader
  where p.profile_id = p_profile_id
    and (p_start_at is null or m.match_date >= p_start_at)
    and (p_end_at is null or m.match_date <= p_end_at)
  group by
    coalesce(l.code, m.player_leader),
    coalesce(l.name, m.player_leader),
    coalesce(l.image_url, ''),
    coalesce(l.parallel_image_url, '')
  order by games desc, wins desc, leader_name asc;
$$;

revoke all on function public.get_public_profile_expansion_stats_v1(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_public_profile_expansion_stats_v1(uuid, timestamptz, timestamptz) to anon, authenticated;

drop function if exists public.get_public_leader_player_stats_v1(text, timestamptz, timestamptz);

create or replace function public.get_public_leader_player_stats_v1(
  p_leader_code text,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null
)
returns table (
  player_id uuid,
  player_name text,
  profile_id uuid,
  profile_username text,
  profile_display_name text,
  games bigint,
  wins bigint,
  winrate numeric
)
language sql
security definer
set search_path = public
as $$
  select
    p.id as player_id,
    p.name as player_name,
    p.profile_id,
    pr.username as profile_username,
    pr.display_name as profile_display_name,
    count(*) as games,
    count(*) filter (where lower(trim(coalesce(m.result, ''))) in ('won', 'win', 'victoria', 'w')) as wins,
    case
      when count(*) > 0 then
        round((count(*) filter (where lower(trim(coalesce(m.result, ''))) in ('won', 'win', 'victoria', 'w'))::numeric / count(*)::numeric) * 100, 1)
      else 0
    end as winrate
  from public.matches m
  join public.players p on p.id = m.player_id
  left join public.profiles pr on pr.id = p.profile_id
  where upper(trim(coalesce(m.player_leader, ''))) = upper(trim(coalesce(p_leader_code, '')))
    and p.profile_id is not null
    and coalesce(pr.member, false) = true
    and (p_start_at is null or m.match_date >= p_start_at)
    and (p_end_at is null or m.match_date <= p_end_at)
  group by p.id, p.name, p.profile_id, pr.username, pr.display_name
  order by games desc, winrate desc, player_name asc
  limit 5;
$$;

revoke all on function public.get_public_leader_player_stats_v1(text, timestamptz, timestamptz) from public;
grant execute on function public.get_public_leader_player_stats_v1(text, timestamptz, timestamptz) to anon, authenticated;
