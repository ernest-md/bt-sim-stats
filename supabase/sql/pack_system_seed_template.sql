-- Template seed for the pack system.
-- The rarity pools and guarantees below are examples only.
-- Do not treat these numbers as official One Piece pull rates.

-- 1) Create a set.
insert into public.pack_sets (
  code,
  name,
  release_date,
  pack_size,
  packs_per_box,
  metadata
)
values (
  'OP12',
  'OP12 Template Set',
  date '2026-01-01',
  12,
  24,
  jsonb_build_object('note', 'replace with the real set data')
)
on conflict (code) do update
set
  name = excluded.name,
  release_date = excluded.release_date,
  pack_size = excluded.pack_size,
  packs_per_box = excluded.packs_per_box,
  metadata = excluded.metadata;

-- 2) Create a pack product.
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
  'OP12 Single Pack',
  'pack',
  100,
  1,
  'default',
  jsonb_build_object('note', 'replace token cost as needed')
from target_set s
on conflict (code) do update
set
  token_cost = excluded.token_cost,
  reveal_mode = excluded.reveal_mode,
  metadata = excluded.metadata;

-- 3) Define pack slot rules.
with target_product as (
  select id
  from public.pack_products
  where code = 'op12_pack'
)
insert into public.pack_product_slots (
  product_id,
  slot_order,
  slot_label,
  picks_per_pack,
  rarity_pool,
  variant_pool,
  allow_duplicates,
  metadata
)
select
  p.id,
  v.slot_order,
  v.slot_label,
  v.picks_per_pack,
  v.rarity_pool,
  v.variant_pool,
  v.allow_duplicates,
  v.metadata
from target_product p
cross join (
  values
    (1, 'base_low', 6, array['C','UC']::text[], null::text[], true,  jsonb_build_object()),
    (2, 'base_mid', 4, array['UC','R']::text[], null::text[], true,  jsonb_build_object()),
    (3, 'hit_slot', 1, array['R','SR']::text[], null::text[], true,  jsonb_build_object()),
    (4, 'variant_slot', 1, array['R','SR','SEC']::text[], array['base','parallel']::text[], true, jsonb_build_object())
) as v(slot_order, slot_label, picks_per_pack, rarity_pool, variant_pool, allow_duplicates, metadata)
on conflict (product_id, slot_order) do update
set
  slot_label = excluded.slot_label,
  picks_per_pack = excluded.picks_per_pack,
  rarity_pool = excluded.rarity_pool,
  variant_pool = excluded.variant_pool,
  allow_duplicates = excluded.allow_duplicates,
  metadata = excluded.metadata;

-- 4) Create a box product based on the pack.
with base_pack as (
  select id, set_id
  from public.pack_products
  where code = 'op12_pack'
)
insert into public.pack_products (
  code,
  set_id,
  source_pack_product_id,
  name,
  product_kind,
  token_cost,
  pack_count,
  reveal_mode,
  metadata
)
select
  'op12_box',
  p.set_id,
  p.id,
  'OP12 Booster Box',
  'box',
  2200,
  24,
  'all_at_once',
  jsonb_build_object('note', 'replace token cost and box count as needed')
from base_pack p
on conflict (code) do update
set
  token_cost = excluded.token_cost,
  pack_count = excluded.pack_count,
  reveal_mode = excluded.reveal_mode,
  metadata = excluded.metadata;

-- 5) Example guarantee rules for the box product.
with target_box as (
  select id
  from public.pack_products
  where code = 'op12_box'
)
insert into public.pack_product_guarantees (
  product_id,
  rarity,
  variant,
  min_count,
  metadata
)
select
  b.id,
  g.rarity,
  g.variant,
  g.min_count,
  g.metadata
from target_box b
cross join (
  values
    ('SR', '*', 7, jsonb_build_object('note', 'placeholder only')),
    ('SEC', '*', 1, jsonb_build_object('note', 'placeholder only'))
) as g(rarity, variant, min_count, metadata)
on conflict (product_id, rarity, variant) do update
set
  min_count = excluded.min_count,
  metadata = excluded.metadata;

-- 6) Example card inserts.
-- Replace these rows with the real card pool for the set.
with target_set as (
  select id
  from public.pack_sets
  where code = 'OP12'
)
insert into public.pack_cards (
  set_id,
  card_code,
  card_name,
  rarity,
  variant,
  card_type,
  image_url,
  draw_weight,
  external_source,
  external_payload
)
select
  s.id,
  c.card_code,
  c.card_name,
  c.rarity,
  c.variant,
  c.card_type,
  c.image_url,
  c.draw_weight,
  c.external_source,
  c.external_payload
from target_set s
cross join (
  values
    ('OP12-001', 'Template Common',   'C',   'base',     'Character', 'https://example.com/op12-001.png', 1.0::numeric, 'manual', '{}'::jsonb),
    ('OP12-045', 'Template Rare',     'R',   'base',     'Event',     'https://example.com/op12-045.png', 1.0::numeric, 'manual', '{}'::jsonb),
    ('OP12-099', 'Template Secret',   'SEC', 'base',     'Character', 'https://example.com/op12-099.png', 1.0::numeric, 'manual', '{}'::jsonb),
    ('OP12-099P', 'Template Parallel','SEC', 'parallel', 'Character', 'https://example.com/op12-099p.png', 0.25::numeric, 'manual', '{}'::jsonb)
) as c(card_code, card_name, rarity, variant, card_type, image_url, draw_weight, external_source, external_payload)
on conflict (set_id, card_code, variant) do update
set
  card_name = excluded.card_name,
  rarity = excluded.rarity,
  card_type = excluded.card_type,
  image_url = excluded.image_url,
  draw_weight = excluded.draw_weight,
  external_source = excluded.external_source,
  external_payload = excluded.external_payload;

-- 7) Test helpers.
-- select public.admin_adjust_tokens('<profile-uuid>', 5000, 'seed_tokens');
-- select public.open_pack_product('op12_pack');
-- select public.open_pack_product('op12_box');
-- select public.open_pack_product_for_profile('op12_pack', '<profile-uuid>');
-- select public.open_pack_product_for_profile('op12_box', '<profile-uuid>');
