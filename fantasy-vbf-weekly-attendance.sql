-- Weekly tournament attendance for VaDeFantasy.
-- Apply after fantasy-vbf-schema.sql.

create table if not exists public.fantasy_vbf_weekly_attendance (
  season text not null references public.fantasy_vbf_seasons(season) on delete cascade,
  round_key text not null,
  player_slug text not null,
  player_name text not null default '',
  attending boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (season, round_key, player_slug),
  check (trim(round_key) <> ''),
  check (trim(player_slug) <> '')
);

create index if not exists fantasy_vbf_weekly_attendance_round_idx
  on public.fantasy_vbf_weekly_attendance (season, round_key, attending, player_slug);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'fantasy_vbf_weekly_attendance_touch_updated_at'
  ) then
    create trigger fantasy_vbf_weekly_attendance_touch_updated_at
    before update on public.fantasy_vbf_weekly_attendance
    for each row execute function public.fantasy_vbf_touch_updated_at();
  end if;
end;
$$;

alter table public.fantasy_vbf_weekly_attendance enable row level security;

drop policy if exists fantasy_vbf_weekly_attendance_select_all
  on public.fantasy_vbf_weekly_attendance;

create policy fantasy_vbf_weekly_attendance_select_all
  on public.fantasy_vbf_weekly_attendance
  for select
  using (true);

revoke all on public.fantasy_vbf_weekly_attendance from public;
grant select on public.fantasy_vbf_weekly_attendance to anon, authenticated;

create or replace function public.fantasy_vbf_require_staff()
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

  select lower(trim(coalesce(app_role, '')))
  into v_role
  from public.profiles
  where id = v_user;

  if coalesce(v_role, '') not in ('admin', 'vdj') then
    raise exception 'Solo Admin o VDJ pueden gestionar la asistencia.';
  end if;
end;
$$;

create or replace function public.fantasy_vbf_set_weekly_attendance(
  p_season text,
  p_round_key text,
  p_player_slug text,
  p_attending boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_season text := upper(trim(coalesce(p_season, '')));
  v_round_key text := trim(coalesce(p_round_key, ''));
  v_player_slug text := trim(coalesce(p_player_slug, ''));
  v_player_name text := '';
  v_attending boolean := coalesce(p_attending, false);
begin
  perform public.fantasy_vbf_require_staff();

  if v_season = '' then
    raise exception 'Temporada fantasy invalida.';
  end if;

  if v_round_key = '' then
    raise exception 'Jornada fantasy invalida.';
  end if;

  if v_player_slug = '' then
    raise exception 'Jugador invalido.';
  end if;

  if not exists (
    select 1
    from public.fantasy_vbf_seasons
    where season = v_season
  ) then
    raise exception 'La temporada fantasy no existe.';
  end if;

  select coalesce(nullif(trim(player_name), ''), v_player_slug)
  into v_player_name
  from public.fantasy_vbf_player_pool
  where season = v_season
    and player_slug = v_player_slug;

  v_player_name := coalesce(nullif(v_player_name, ''), v_player_slug);

  insert into public.fantasy_vbf_weekly_attendance (
    season, round_key, player_slug, player_name, attending, updated_by
  )
  values (
    v_season, v_round_key, v_player_slug, v_player_name, v_attending, v_user
  )
  on conflict (season, round_key, player_slug) do update
    set player_name = excluded.player_name,
        attending = excluded.attending,
        updated_by = excluded.updated_by,
        updated_at = timezone('utc', now());

  return jsonb_build_object(
    'season', v_season,
    'round_key', v_round_key,
    'player_slug', v_player_slug,
    'player_name', v_player_name,
    'attending', v_attending,
    'updated_by', v_user
  );
end;
$$;

grant execute on function public.fantasy_vbf_require_staff() to authenticated;
grant execute on function public.fantasy_vbf_set_weekly_attendance(text, text, text, boolean) to authenticated;
