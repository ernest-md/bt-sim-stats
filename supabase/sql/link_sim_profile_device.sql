-- Link authenticated profile -> player -> device_id from SIM URL parsing in frontend.
-- Run this in Supabase SQL editor for your project.

alter table public.players
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_profile_id_key'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_profile_id_key unique (profile_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'devices_device_id_key'
      and conrelid = 'public.devices'::regclass
  ) then
    alter table public.devices
      add constraint devices_device_id_key unique (device_id);
  end if;
end $$;

create or replace function public.link_sim_profile_device(
  p_profile_id uuid,
  p_player_name text,
  p_device_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_existing_player_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_profile_id is null or p_profile_id <> auth.uid() then
    raise exception 'Forbidden profile id';
  end if;

  p_player_name := btrim(coalesce(p_player_name, ''));
  p_device_id := btrim(coalesce(p_device_id, ''));

  if p_player_name = '' then
    raise exception 'Player name is required';
  end if;

  if p_device_id = '' then
    raise exception 'Device id is required';
  end if;

  select id
  into v_player_id
  from public.players
  where profile_id = p_profile_id
  limit 1;

  select player_id
  into v_existing_player_id
  from public.devices
  where device_id = p_device_id
  limit 1;

  if v_existing_player_id is not null and v_player_id is not null and v_existing_player_id <> v_player_id then
    raise exception 'Device id already linked to another player';
  end if;

  if v_existing_player_id is not null and v_player_id is null then
    raise exception 'Device id already linked to another player';
  end if;

  insert into public.players(profile_id, name)
  values (p_profile_id, p_player_name)
  on conflict on constraint players_profile_id_key do update
    set name = excluded.name
  returning id into v_player_id;

  insert into public.devices(player_id, device_id)
  values (v_player_id, p_device_id)
  on conflict on constraint devices_device_id_key do update
    set player_id = excluded.player_id;

  return v_player_id;
end;
$$;

grant execute on function public.link_sim_profile_device(uuid, text, text) to authenticated;
