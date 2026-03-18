-- OP12 pocket-like probability seed.
--
-- Assumptions behind this config:
-- - Packs are digital and use 5 cards, with one archetype that can reveal 6
-- - There is no box collation / guarantee logic
-- - The existing product code is op12_pack
-- - Imported card variants for this set are expected to follow:
--   base / parallel_p1 / sp_parallel_p2 / manga_parallel_p2 /
--   treasure_rare / sp_silver_parallel_p4 / sp_gold_parallel_p5
--
-- Apply after:
-- 1) pack_system.sql
-- 2) pack_probability_mode_patch.sql
-- 3) pack_cards import for OP12

begin;

update public.pack_sets
set
  pack_size = 5,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'opening_model', 'probability_archetypes',
    'notes', 'Pocket-like digital pack model with occasional +1 pack'
  )
where code = 'OP12';

with target_set as (
  select id
  from public.pack_sets
  where code = 'OP12'
)
insert into public.pack_products (
  code,
  set_id,
  name,
  product_kind,
  token_cost,
  pack_count,
  reveal_mode,
  metadata
)
select
  'op12_pack',
  s.id,
  'OP12 Digital Pack',
  'pack',
  100,
  1,
  'default',
  jsonb_build_object(
    'opening_model', 'probability_archetypes',
    'notes', '5-card digital pack inspired by Pocket-style distribution'
  )
from target_set s
on conflict (code) do update
set
  set_id = excluded.set_id,
  name = excluded.name,
  product_kind = excluded.product_kind,
  token_cost = excluded.token_cost,
  pack_count = excluded.pack_count,
  reveal_mode = excluded.reveal_mode,
  metadata = excluded.metadata;

with target_product as (
  select id
  from public.pack_products
  where code = 'op12_pack'
)
insert into public.pack_product_archetypes (
  product_id,
  code,
  label,
  weight,
  card_count,
  metadata
)
select
  p.id,
  v.code,
  v.label,
  v.weight,
  v.card_count,
  v.metadata
from target_product p
cross join (
  values
    ('normal_pack', 'Sobre normal', 94.711000::numeric, 5, jsonb_build_object('notes', 'Standard 5-card pack')),
    ('normal_plus_one', 'Sobre normal +1', 5.238000::numeric, 6, jsonb_build_object('notes', 'Standard 5-card pack plus shiny slot')),
    ('god_pack', 'God pack', 0.050000::numeric, 5, jsonb_build_object('notes', 'All 5 cards come from high-rarity outcomes'))
) as v(code, label, weight, card_count, metadata)
on conflict (product_id, code) do update
set
  label = excluded.label,
  weight = excluded.weight,
  card_count = excluded.card_count,
  metadata = excluded.metadata,
  is_active = true;

with target_archetypes as (
  select a.id
  from public.pack_product_archetypes a
  join public.pack_products p on p.id = a.product_id
  where p.code = 'op12_pack'
)
delete from public.pack_product_archetype_slot_outcomes
where archetype_id in (select id from target_archetypes);

with target_archetypes as (
  select
    a.id,
    a.code
  from public.pack_product_archetypes a
  join public.pack_products p on p.id = a.product_id
  where p.code = 'op12_pack'
),
rows as (
  select *
  from (
    values
      -- normal_pack: slots 1-3
      ('normal_pack', 1, 1, 'C base',       90.000000::numeric, array['C']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_pack', 1, 2, 'L base',       10.000000::numeric, array['L']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  1),
      ('normal_pack', 2, 1, 'C base',       90.000000::numeric, array['C']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_pack', 2, 2, 'L base',       10.000000::numeric, array['L']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  1),
      ('normal_pack', 3, 1, 'C base',       90.000000::numeric, array['C']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_pack', 3, 2, 'L base',       10.000000::numeric, array['L']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  1),

      -- normal_pack: slot 4
      ('normal_pack', 4, 1, 'Manga P2',      0.013333::numeric, null::text[],         'any',          array['%manga_parallel_p2%']::text[],         null::text[],                                                   true,  null::integer),
      ('normal_pack', 4, 2, 'Silver P4',     0.013333::numeric, null::text[],         'any',          array['%sp_silver_parallel_p4%']::text[],     null::text[],                                                   true,  null::integer),
      ('normal_pack', 4, 3, 'Gold P5',       0.013334::numeric, null::text[],         'any',          array['%sp_gold_parallel_p5%']::text[],       null::text[],                                                   true,  null::integer),
      ('normal_pack', 4, 4, 'L AA',          0.044400::numeric, array['L']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_pack', 4, 5, 'SEC AA',        0.177600::numeric, array['SEC']::text[], 'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_pack', 4, 6, 'SR AA',         0.500000::numeric, array['SR']::text[],  'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_pack', 4, 7, 'SEC base',      0.500100::numeric, array['SEC']::text[], 'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_pack', 4, 8, 'R AA',          1.166900::numeric, array['R']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_pack', 4, 9, 'SR base',       2.572000::numeric, array['SR']::text[],  'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_pack', 4, 10, 'R base',       5.000000::numeric, array['R']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_pack', 4, 11, 'UC base',     89.999000::numeric, array['UC']::text[],  'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),

      -- normal_pack: slot 5
      ('normal_pack', 5, 1, 'Manga P2',      0.053333::numeric, null::text[],         'any',          array['%manga_parallel_p2%']::text[],         null::text[],                                                   true,  null::integer),
      ('normal_pack', 5, 2, 'Silver P4',     0.053333::numeric, null::text[],         'any',          array['%sp_silver_parallel_p4%']::text[],     null::text[],                                                   true,  null::integer),
      ('normal_pack', 5, 3, 'Gold P5',       0.053334::numeric, null::text[],         'any',          array['%sp_gold_parallel_p5%']::text[],       null::text[],                                                   true,  null::integer),
      ('normal_pack', 5, 4, 'L AA',          0.177800::numeric, array['L']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_pack', 5, 5, 'SEC AA',        0.711200::numeric, array['SEC']::text[], 'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_pack', 5, 6, 'SR AA',         2.000000::numeric, array['SR']::text[],  'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_pack', 5, 7, 'SEC base',      2.000100::numeric, array['SEC']::text[], 'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_pack', 5, 8, 'R AA',          4.666900::numeric, array['R']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_pack', 5, 9, 'SR base',      10.286000::numeric, array['SR']::text[],  'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_pack', 5, 10, 'R base',      20.000000::numeric, array['R']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_pack', 5, 11, 'UC base',     59.998000::numeric, array['UC']::text[],  'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),

      -- normal_plus_one: slots 1-5 same as normal_pack
      ('normal_plus_one', 1, 1, 'C base',       90.000000::numeric, array['C']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 1, 2, 'L base',       10.000000::numeric, array['L']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  1),
      ('normal_plus_one', 2, 1, 'C base',       90.000000::numeric, array['C']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 2, 2, 'L base',       10.000000::numeric, array['L']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  1),
      ('normal_plus_one', 3, 1, 'C base',       90.000000::numeric, array['C']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 3, 2, 'L base',       10.000000::numeric, array['L']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  1),
      ('normal_plus_one', 4, 1, 'Manga P2',      0.013333::numeric, null::text[],         'any',          array['%manga_parallel_p2%']::text[],         null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 4, 2, 'Silver P4',     0.013333::numeric, null::text[],         'any',          array['%sp_silver_parallel_p4%']::text[],     null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 4, 3, 'Gold P5',       0.013334::numeric, null::text[],         'any',          array['%sp_gold_parallel_p5%']::text[],       null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 4, 4, 'L AA',          0.044400::numeric, array['L']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 4, 5, 'SEC AA',        0.177600::numeric, array['SEC']::text[], 'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 4, 6, 'SR AA',         0.500000::numeric, array['SR']::text[],  'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 4, 7, 'SEC base',      0.500100::numeric, array['SEC']::text[], 'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 4, 8, 'R AA',          1.166900::numeric, array['R']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 4, 9, 'SR base',       2.572000::numeric, array['SR']::text[],  'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 4, 10, 'R base',       5.000000::numeric, array['R']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 4, 11, 'UC base',     89.999000::numeric, array['UC']::text[],  'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 5, 1, 'Manga P2',      0.053333::numeric, null::text[],         'any',          array['%manga_parallel_p2%']::text[],         null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 5, 2, 'Silver P4',     0.053333::numeric, null::text[],         'any',          array['%sp_silver_parallel_p4%']::text[],     null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 5, 3, 'Gold P5',       0.053334::numeric, null::text[],         'any',          array['%sp_gold_parallel_p5%']::text[],       null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 5, 4, 'L AA',          0.177800::numeric, array['L']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 5, 5, 'SEC AA',        0.711200::numeric, array['SEC']::text[], 'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 5, 6, 'SR AA',         2.000000::numeric, array['SR']::text[],  'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 5, 7, 'SEC base',      2.000100::numeric, array['SEC']::text[], 'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 5, 8, 'R AA',          4.666900::numeric, array['R']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 5, 9, 'SR base',      10.286000::numeric, array['SR']::text[],  'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 5, 10, 'R base',      20.000000::numeric, array['R']::text[],   'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 5, 11, 'UC base',     59.998000::numeric, array['UC']::text[],  'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 6, 1, 'SP',           68.180000::numeric, null::text[],         'any',          array['%sp_parallel_p2%']::text[],            null::text[],                                                   true,  null::integer),
      ('normal_plus_one', 6, 2, 'TR',           31.820000::numeric, array['TR']::text[],  'any',          array['%treasure_rare%']::text[],             null::text[],                                                   true,  null::integer),

      -- god_pack: 5 identical premium slots
      ('god_pack', 1, 1, 'Manga P2',      1.587000::numeric, null::text[],         'any',          array['%manga_parallel_p2%']::text[],         null::text[],                                                   true,  null::integer),
      ('god_pack', 1, 2, 'Silver P4',     1.587000::numeric, null::text[],         'any',          array['%sp_silver_parallel_p4%']::text[],     null::text[],                                                   true,  null::integer),
      ('god_pack', 1, 3, 'Gold P5',       1.587000::numeric, null::text[],         'any',          array['%sp_gold_parallel_p5%']::text[],       null::text[],                                                   true,  null::integer),
      ('god_pack', 1, 4, 'L AA',          0.952200::numeric, array['L']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 1, 5, 'SEC AA',        3.808800::numeric, array['SEC']::text[], 'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 1, 6, 'SR AA',        52.380000::numeric, array['SR']::text[],  'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 1, 7, 'SEC base',     11.428500::numeric, array['SEC']::text[], 'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('god_pack', 1, 8, 'R AA',         26.666500::numeric, array['R']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 2, 1, 'Manga P2',      1.587000::numeric, null::text[],         'any',          array['%manga_parallel_p2%']::text[],         null::text[],                                                   true,  null::integer),
      ('god_pack', 2, 2, 'Silver P4',     1.587000::numeric, null::text[],         'any',          array['%sp_silver_parallel_p4%']::text[],     null::text[],                                                   true,  null::integer),
      ('god_pack', 2, 3, 'Gold P5',       1.587000::numeric, null::text[],         'any',          array['%sp_gold_parallel_p5%']::text[],       null::text[],                                                   true,  null::integer),
      ('god_pack', 2, 4, 'L AA',          0.952200::numeric, array['L']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 2, 5, 'SEC AA',        3.808800::numeric, array['SEC']::text[], 'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 2, 6, 'SR AA',        52.380000::numeric, array['SR']::text[],  'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 2, 7, 'SEC base',     11.428500::numeric, array['SEC']::text[], 'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('god_pack', 2, 8, 'R AA',         26.666500::numeric, array['R']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 3, 1, 'Manga P2',      1.587000::numeric, null::text[],         'any',          array['%manga_parallel_p2%']::text[],         null::text[],                                                   true,  null::integer),
      ('god_pack', 3, 2, 'Silver P4',     1.587000::numeric, null::text[],         'any',          array['%sp_silver_parallel_p4%']::text[],     null::text[],                                                   true,  null::integer),
      ('god_pack', 3, 3, 'Gold P5',       1.587000::numeric, null::text[],         'any',          array['%sp_gold_parallel_p5%']::text[],       null::text[],                                                   true,  null::integer),
      ('god_pack', 3, 4, 'L AA',          0.952200::numeric, array['L']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 3, 5, 'SEC AA',        3.808800::numeric, array['SEC']::text[], 'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 3, 6, 'SR AA',        52.380000::numeric, array['SR']::text[],  'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 3, 7, 'SEC base',     11.428500::numeric, array['SEC']::text[], 'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('god_pack', 3, 8, 'R AA',         26.666500::numeric, array['R']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 4, 1, 'Manga P2',      1.587000::numeric, null::text[],         'any',          array['%manga_parallel_p2%']::text[],         null::text[],                                                   true,  null::integer),
      ('god_pack', 4, 2, 'Silver P4',     1.587000::numeric, null::text[],         'any',          array['%sp_silver_parallel_p4%']::text[],     null::text[],                                                   true,  null::integer),
      ('god_pack', 4, 3, 'Gold P5',       1.587000::numeric, null::text[],         'any',          array['%sp_gold_parallel_p5%']::text[],       null::text[],                                                   true,  null::integer),
      ('god_pack', 4, 4, 'L AA',          0.952200::numeric, array['L']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 4, 5, 'SEC AA',        3.808800::numeric, array['SEC']::text[], 'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 4, 6, 'SR AA',        52.380000::numeric, array['SR']::text[],  'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 4, 7, 'SEC base',     11.428500::numeric, array['SEC']::text[], 'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('god_pack', 4, 8, 'R AA',         26.666500::numeric, array['R']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 5, 1, 'Manga P2',      1.587000::numeric, null::text[],         'any',          array['%manga_parallel_p2%']::text[],         null::text[],                                                   true,  null::integer),
      ('god_pack', 5, 2, 'Silver P4',     1.587000::numeric, null::text[],         'any',          array['%sp_silver_parallel_p4%']::text[],     null::text[],                                                   true,  null::integer),
      ('god_pack', 5, 3, 'Gold P5',       1.587000::numeric, null::text[],         'any',          array['%sp_gold_parallel_p5%']::text[],       null::text[],                                                   true,  null::integer),
      ('god_pack', 5, 4, 'L AA',          0.952200::numeric, array['L']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 5, 5, 'SEC AA',        3.808800::numeric, array['SEC']::text[], 'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 5, 6, 'SR AA',        52.380000::numeric, array['SR']::text[],  'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer),
      ('god_pack', 5, 7, 'SEC base',     11.428500::numeric, array['SEC']::text[], 'base_only',    null::text[],                                  null::text[],                                                   true,  null::integer),
      ('god_pack', 5, 8, 'R AA',         26.666500::numeric, array['R']::text[],   'any',          array['%parallel_p1%']::text[],               null::text[],                                                   true,  null::integer)
  ) as t(archetype_code, slot_order, outcome_order, outcome_label, probability_weight, rarity_pool, variant_mode, variant_include_patterns, variant_exclude_patterns, allow_duplicates, max_matches_per_pack)
)
insert into public.pack_product_archetype_slot_outcomes (
  archetype_id,
  slot_order,
  outcome_order,
  outcome_label,
  probability_weight,
  rarity_pool,
  variant_mode,
  variant_include_patterns,
  variant_exclude_patterns,
  allow_duplicates,
  max_matches_per_pack,
  metadata
)
select
  a.id,
  r.slot_order,
  r.outcome_order,
  r.outcome_label,
  r.probability_weight,
  r.rarity_pool,
  r.variant_mode,
  r.variant_include_patterns,
  r.variant_exclude_patterns,
  r.allow_duplicates,
  r.max_matches_per_pack,
  jsonb_build_object('seed', 'op12_probability_seed')
from rows r
join target_archetypes a
  on a.code = r.archetype_code;

commit;

-- Optional: if you want to hide old box products while testing this model:
-- update public.pack_products
-- set is_active = false
-- where code in ('op12_box');
