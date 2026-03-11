-- Manual exceptions for SIM users whose device_id includes matches from multiple people.
-- Run this in Supabase SQL editor after adding matches.player_name text.

create table if not exists public.sim_player_name_overrides (
  player_id uuid primary key references public.players(id) on delete cascade,
  expected_player_name text not null,
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_sim_player_name_overrides_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_sim_player_name_overrides_updated_at
on public.sim_player_name_overrides;

create trigger trg_sim_player_name_overrides_updated_at
before update on public.sim_player_name_overrides
for each row
execute function public.touch_sim_player_name_overrides_updated_at();

create or replace function public.normalize_sim_player_name(raw_name text)
returns text
language sql
immutable
as $$
  select nullif(
    split_part(
      lower(
        trim(
          regexp_replace(coalesce(raw_name, ''), '[\u200B\u200C\u200D\uFEFF]', '', 'g')
        )
      ),
      '#',
      1
    ),
    ''
  );
$$;

alter table public.sim_player_name_overrides enable row level security;

drop policy if exists sim_player_name_overrides_select_admin_only
on public.sim_player_name_overrides;

create policy sim_player_name_overrides_select_admin_only
on public.sim_player_name_overrides
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.app_role in ('admin', 'staff')
  )
);

drop policy if exists sim_player_name_overrides_manage_admin_only
on public.sim_player_name_overrides;

create policy sim_player_name_overrides_manage_admin_only
on public.sim_player_name_overrides
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.app_role in ('admin', 'staff')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.app_role in ('admin', 'staff')
  )
);

grant select, insert, update, delete on public.sim_player_name_overrides to authenticated;
grant execute on function public.normalize_sim_player_name(text) to authenticated;

-- Example:
-- insert into public.sim_player_name_overrides(player_id, expected_player_name, notes)
-- select p.id, 'Cojinho', 'Shared deviceId edge case'
-- from public.players p
-- join public.profiles pr on pr.id = p.profile_id
-- where pr.username = 'cojinho'
-- on conflict (player_id) do update
--   set expected_player_name = excluded.expected_player_name,
--       notes = excluded.notes,
--       enabled = true,
--       updated_at = now();
