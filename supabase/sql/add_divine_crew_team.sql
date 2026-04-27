-- Add DIVINE CREW as an allowed profile team.
-- Note: current codebase uses CARDGUILD as the stored value for the team
-- that may be referred to in the UI/business context as Crossguild.

alter table public.profiles
  drop constraint if exists profiles_team_check;

alter table public.profiles
  add constraint profiles_team_check
  check (team in (
    'SIN EQUIPO',
    'BARATEAM',
    'LABOOMERS',
    'YONKOJOS',
    'CARDGUILD',
    'DIVINE CREW'
  ));
