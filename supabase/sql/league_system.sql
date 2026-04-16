-- League tables for Barateam Hub.
-- Run this in Supabase SQL editor before switching liga.html from seeded fallback to DB-only data.

create table if not exists public.league_player_leaders (
  id bigserial primary key,
  league_id text not null,
  player_name text not null,
  leader_slot smallint not null check (leader_slot between 1 and 3),
  leader_name text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, player_name, leader_slot)
);

create table if not exists public.league_match_results (
  id bigserial primary key,
  league_id text not null,
  result text not null,
  player_1 text not null,
  player_2 text not null,
  leader_player_1 text,
  leader_player_2 text,
  source_match_id text,
  played_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists league_match_results_unique_source_match
on public.league_match_results (league_id, source_match_id);

create or replace function public.touch_league_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_league_player_leaders_updated_at
on public.league_player_leaders;

create trigger trg_league_player_leaders_updated_at
before update on public.league_player_leaders
for each row
execute function public.touch_league_updated_at();

drop trigger if exists trg_league_match_results_updated_at
on public.league_match_results;

create trigger trg_league_match_results_updated_at
before update on public.league_match_results
for each row
execute function public.touch_league_updated_at();

alter table public.league_player_leaders enable row level security;
alter table public.league_match_results enable row level security;

drop policy if exists league_player_leaders_select_authenticated
on public.league_player_leaders;

create policy league_player_leaders_select_authenticated
on public.league_player_leaders
for select
to authenticated
using (true);

drop policy if exists league_player_leaders_manage_admin_only
on public.league_player_leaders;

create policy league_player_leaders_manage_admin_only
on public.league_player_leaders
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

drop policy if exists league_match_results_select_authenticated
on public.league_match_results;

create policy league_match_results_select_authenticated
on public.league_match_results
for select
to authenticated
using (true);

drop policy if exists league_match_results_manage_admin_only
on public.league_match_results;

create policy league_match_results_manage_admin_only
on public.league_match_results
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

grant select on public.league_player_leaders to authenticated;
grant select on public.league_match_results to authenticated;
grant insert, update, delete on public.league_player_leaders to authenticated;
grant insert, update, delete on public.league_match_results to authenticated;
grant usage, select on sequence public.league_player_leaders_id_seq to authenticated;
grant usage, select on sequence public.league_match_results_id_seq to authenticated;

insert into public.league_player_leaders (league_id, player_name, leader_slot, leader_name)
values
  ('op15', 'Charko', 1, 'Kalgara Y'),
  ('op15', 'Charko', 2, 'Lucy RU'),
  ('op15', 'Charko', 3, 'Nami UY'),
  ('op15', 'Dilix', 1, 'Carrot G'),
  ('op15', 'Dilix', 2, 'Nami UY'),
  ('op15', 'Dilix', 3, 'Luffy BP'),
  ('op15', 'Ernest', 1, 'Lucy RU'),
  ('op15', 'Ernest', 2, 'Brook GB'),
  ('op15', 'Ernest', 3, 'Doffy P'),
  ('op15', 'Coquito', 1, 'Don Krieg RG'),
  ('op15', 'Coquito', 2, 'Foxy P'),
  ('op15', 'Coquito', 3, 'Katakuri P'),
  ('op15', 'Romo', 1, 'Enel P'),
  ('op15', 'Romo', 2, 'Luffy Y OP15'),
  ('op15', 'Romo', 3, 'Nami UY'),
  ('op15', 'Sicari', 1, 'Ace RU'),
  ('op15', 'Sicari', 2, 'Koby RB'),
  ('op15', 'Sicari', 3, 'Roger RP'),
  ('op15', 'Daword', 1, 'Enel P'),
  ('op15', 'Daword', 2, 'Enel Y'),
  ('op15', 'Daword', 3, 'Bonney RY'),
  ('op15', 'Noke', 1, 'Nami UY'),
  ('op15', 'Noke', 2, 'Luffy Y OP15'),
  ('op15', 'Noke', 3, 'Blackbeard B'),
  ('op15', 'MajinMoonwalker', 1, 'Moria BY'),
  ('op15', 'MajinMoonwalker', 2, 'Ace RU'),
  ('op15', 'MajinMoonwalker', 3, 'Luffy B ST14'),
  ('op15', 'Papa Nami', 1, 'Vegapunk Y'),
  ('op15', 'Papa Nami', 2, 'Nami UY'),
  ('op15', 'Papa Nami', 3, 'Koby RB'),
  ('op15', 'Humano', 1, 'Nami UY'),
  ('op15', 'Humano', 2, 'Enel P'),
  ('op15', 'Humano', 3, 'Luffy Y OP15'),
  ('op15', 'Karoo', 1, 'Nami UY'),
  ('op15', 'Karoo', 2, 'Enel P'),
  ('op15', 'Karoo', 3, 'Ace RU'),
  ('op15', 'Colecta', 1, 'Jinbe U'),
  ('op15', 'Colecta', 2, 'Luffy GP'),
  ('op15', 'Colecta', 3, 'Nami UY'),
  ('op15', 'Ezelpro', 1, 'Don Krieg RG'),
  ('op15', 'Ezelpro', 2, 'Luffy BP'),
  ('op15', 'Ezelpro', 3, 'Sanji R'),
  ('op15', 'Cojinho', 1, 'Blackbeard B'),
  ('op15', 'Cojinho', 2, 'Enel P'),
  ('op15', 'Cojinho', 3, 'Lucy RU'),
  ('op15', 'Isaac', 1, 'Bonney G'),
  ('op15', 'Isaac', 2, 'Smoker RG'),
  ('op15', 'Isaac', 3, 'Luffy RG'),
  ('op15', 'Semidimoni', 1, 'Ace RU'),
  ('op15', 'Semidimoni', 2, 'Luffy Y OP15'),
  ('op15', 'Semidimoni', 3, 'Nami UY'),
  ('op15', 'Joselu', 1, 'Ace RU'),
  ('op15', 'Joselu', 2, 'Lucy RU'),
  ('op15', 'Joselu', 3, 'Doffy P'),
  ('op15', 'Lenox', 1, 'Moria BY'),
  ('op15', 'Lenox', 2, 'Ace RU'),
  ('op15', 'Lenox', 3, 'Enel P'),
  ('op15', 'Strainer', 1, 'Enel P'),
  ('op15', 'Strainer', 2, 'Nami UY'),
  ('op15', 'Strainer', 3, 'Bonney RY'),
  ('op15', 'VainaLoca', 1, 'Luffy Y OP15'),
  ('op15', 'VainaLoca', 2, 'Lucy RU'),
  ('op15', 'VainaLoca', 3, 'Moria BY'),
  ('op15', 'Xavisu', 1, 'Crocodile B'),
  ('op15', 'Xavisu', 2, 'Kalgara Y'),
  ('op15', 'Xavisu', 3, 'Luffy RG'),
  ('op15', 'Yago', 1, 'Enel P'),
  ('op15', 'Yago', 2, 'Nami UY'),
  ('op15', 'Yago', 3, 'Ace RU'),
  ('op15', 'Keldas', 1, 'Don Krieg RG'),
  ('op15', 'Keldas', 2, 'Caesar RU'),
  ('op15', 'Keldas', 3, 'Koala BY'),
  ('op15', 'Cape', 1, 'Enel Y'),
  ('op15', 'Cape', 2, 'Enel P'),
  ('op15', 'Cape', 3, 'Doffy P'),
  ('op15', 'Bastian', 1, 'Luffy Y'),
  ('op15', 'Bastian', 2, 'Crocodile B'),
  ('op15', 'Bastian', 3, 'Buggy U'),
  ('op15', 'Dani R.', 1, 'Moria BY'),
  ('op15', 'Dani R.', 2, 'Luffy BY'),
  ('op15', 'Dani R.', 3, 'Rosinante PY'),
  ('op15', 'DavidVaz', 1, 'Lucy RU'),
  ('op15', 'DavidVaz', 2, 'Crocodile B'),
  ('op15', 'DavidVaz', 3, 'Luffy RG'),
  ('op15', 'Martí', 1, 'Yamato GY'),
  ('op15', 'Martí', 2, 'Enel P'),
  ('op15', 'Martí', 3, 'Bonney RY'),
  ('op15', 'MIGUEL', 1, 'Luffy Y'),
  ('op15', 'MIGUEL', 2, 'Luffy Y OP15'),
  ('op15', 'Oriol', 1, 'Bonney RY'),
  ('op15', 'Oriol', 2, 'Imu B'),
  ('op15', 'Oriol', 3, 'Don Krieg RG')
on conflict (league_id, player_name, leader_slot)
do update set
  leader_name = excluded.leader_name,
  updated_at = now();
