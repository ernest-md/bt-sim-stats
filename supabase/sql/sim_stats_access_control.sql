-- SIM Stats access control (RLS + roles + per-player grants)
-- Goal:
-- 1) Default user can only view own player/matches/devices.
-- 2) Admin/staff can view all.
-- 3) Optional per-player grants for delegated access.

-- 1) Roles in profiles
alter table public.profiles
  add column if not exists app_role text not null default 'user';

alter table public.profiles
  drop constraint if exists profiles_app_role_check;

alter table public.profiles
  add constraint profiles_app_role_check
  check (app_role in ('user', 'staff', 'admin'));

-- 2) Optional delegated access table
create table if not exists public.sim_stats_access_grants (
  id uuid primary key default gen_random_uuid(),
  viewer_profile_id uuid not null references public.profiles(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (viewer_profile_id, player_id)
);

create index if not exists sim_stats_access_grants_viewer_idx
  on public.sim_stats_access_grants(viewer_profile_id);

create index if not exists sim_stats_access_grants_player_idx
  on public.sim_stats_access_grants(player_id);

-- 3) Access helper function
create or replace function public.can_view_player(p_viewer_id uuid, p_player_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.players p
    where p.id = p_player_id
      and (
        p.profile_id = p_viewer_id
        or exists (
          select 1
          from public.profiles pr
          where pr.id = p_viewer_id
            and pr.app_role in ('admin', 'staff')
        )
        or exists (
          select 1
          from public.sim_stats_access_grants g
          where g.viewer_profile_id = p_viewer_id
            and g.player_id = p_player_id
        )
      )
  );
$$;

-- 4) RLS: players
alter table public.players enable row level security;

drop policy if exists players_select_access on public.players;
create policy players_select_access
on public.players
for select
to authenticated
using (public.can_view_player(auth.uid(), id));

-- 5) RLS: matches
alter table public.matches enable row level security;

drop policy if exists matches_select_access on public.matches;
create policy matches_select_access
on public.matches
for select
to authenticated
using (public.can_view_player(auth.uid(), player_id));

-- 6) RLS: devices
alter table public.devices enable row level security;

drop policy if exists devices_select_access on public.devices;
create policy devices_select_access
on public.devices
for select
to authenticated
using (public.can_view_player(auth.uid(), player_id));

-- 7) RLS for grants table
alter table public.sim_stats_access_grants enable row level security;

drop policy if exists grants_select_own_or_admin on public.sim_stats_access_grants;
create policy grants_select_own_or_admin
on public.sim_stats_access_grants
for select
to authenticated
using (
  viewer_profile_id = auth.uid()
  or exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.app_role in ('admin', 'staff')
  )
);

drop policy if exists grants_manage_admin_only on public.sim_stats_access_grants;
create policy grants_manage_admin_only
on public.sim_stats_access_grants
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.app_role in ('admin', 'staff')
  )
)
with check (
  exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.app_role in ('admin', 'staff')
  )
);

-- 8) Helpful examples:
-- Promote a user:
-- update public.profiles set app_role = 'admin' where username = 'coquito';
--
-- Grant user 'keldas' access to player 'Coquito':
-- insert into public.sim_stats_access_grants(viewer_profile_id, player_id)
-- select p1.id, p2.id
-- from public.profiles p1
-- join public.players p2 on p2.name = 'Coquito'
-- where p1.username = 'keldas'
-- on conflict do nothing;
