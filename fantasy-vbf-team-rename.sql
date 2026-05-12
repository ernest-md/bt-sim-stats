create or replace function public.fantasy_vbf_rename_team(
  p_season text,
  p_team_name text
)
returns public.fantasy_vbf_teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := left(btrim(coalesce(p_team_name, '')), 60);
  v_team public.fantasy_vbf_teams%rowtype;
begin
  if v_user is null then raise exception 'Debes iniciar sesion.'; end if;
  if v_name = '' then raise exception 'El nombre del equipo no puede estar vacio.'; end if;

  update public.fantasy_vbf_teams
  set team_name = v_name
  where season = coalesce(nullif(btrim(p_season), ''), 'OP15')
    and user_id = v_user
  returning * into v_team;

  if not found then raise exception 'No tienes equipo en esta temporada.'; end if;
  return v_team;
end;
$$;

grant execute on function public.fantasy_vbf_rename_team(text, text) to authenticated;
