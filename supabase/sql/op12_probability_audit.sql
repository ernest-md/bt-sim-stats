-- OP12 probability-mode audit queries
--
-- Profile UUID prefilled for tests:
-- ccc4481c-9faf-483d-8efd-45acb2a33386
-- Replace it if you want to audit another profile.
-- Run sections independently in the Supabase SQL editor.

-- 1) Inventory loaded for OP12 by rarity and variant.
select
  c.rarity,
  c.variant,
  count(*) as cards
from public.pack_cards c
join public.pack_sets s
  on s.id = c.set_id
where s.code = 'OP12'
  and c.is_active = true
group by c.rarity, c.variant
order by c.rarity, c.variant;

-- 2) Check that every configured outcome has valid OP12 candidates.
with configured as (
  select
    a.code as archetype_code,
    o.slot_order,
    o.outcome_order,
    o.outcome_label,
    o.probability_weight,
    o.rarity_pool,
    o.variant_mode,
    o.variant_include_patterns,
    o.variant_exclude_patterns
  from public.pack_product_archetypes a
  join public.pack_products p
    on p.id = a.product_id
  join public.pack_product_archetype_slot_outcomes o
    on o.archetype_id = a.id
  where p.code = 'op12_pack'
)
select
  cfg.archetype_code,
  cfg.slot_order,
  cfg.outcome_order,
  cfg.outcome_label,
  cfg.probability_weight,
  (
    select count(*)
    from public.pack_cards c
    join public.pack_sets s
      on s.id = c.set_id
    where s.code = 'OP12'
      and c.is_active = true
      and public.pack_card_matches_filters(
        c.rarity,
        c.variant,
        cfg.rarity_pool,
        cfg.variant_mode,
        cfg.variant_include_patterns,
        cfg.variant_exclude_patterns
      )
  ) as matching_cards,
  (
    select string_agg(x.variant, ', ' order by x.variant)
    from (
      select distinct c.variant
      from public.pack_cards c
      join public.pack_sets s
        on s.id = c.set_id
      where s.code = 'OP12'
        and c.is_active = true
        and public.pack_card_matches_filters(
          c.rarity,
          c.variant,
          cfg.rarity_pool,
          cfg.variant_mode,
          cfg.variant_include_patterns,
          cfg.variant_exclude_patterns
        )
      order by c.variant
      limit 5
    ) x
  ) as sample_variants
from configured cfg
order by cfg.archetype_code, cfg.slot_order, cfg.outcome_order;

-- 3) Latest OP12 openings for one profile, with archetype and cards expanded.
with params as (
  select
    'ccc4481c-9faf-483d-8efd-45acb2a33386'::uuid as profile_id,
    25::integer as sample_openings
),
target_openings as (
  select o.*
  from public.pack_openings o
  join public.pack_products p
    on p.id = o.product_id
  where p.code = 'op12_pack'
    and o.profile_id = (select profile_id from params)
  order by o.created_at desc
  limit (select sample_openings from params)
),
pack_types as (
  select
    o.id as opening_id,
    (pt.value->>'pack_index')::integer as pack_index,
    pt.value->>'archetype_code' as archetype_code,
    pt.value->>'archetype_label' as archetype_label
  from target_openings o
  cross join lateral jsonb_array_elements(
    coalesce(o.result_summary->'pack_types', '[]'::jsonb)
  ) as pt(value)
)
select
  o.created_at,
  o.id as opening_id,
  pt.archetype_code,
  oc.pack_index,
  oc.slot_order,
  c.card_code,
  c.card_name,
  c.rarity,
  c.variant
from target_openings o
join public.pack_opening_cards oc
  on oc.opening_id = o.id
join public.pack_cards c
  on c.id = oc.card_id
left join pack_types pt
  on pt.opening_id = o.id
 and pt.pack_index = oc.pack_index
order by o.created_at desc, oc.pack_index, oc.slot_order;

-- 4) Observed archetype mix from the latest N OP12 openings for one profile.
with params as (
  select
    'ccc4481c-9faf-483d-8efd-45acb2a33386'::uuid as profile_id,
    500::integer as sample_openings
),
target_openings as (
  select o.*
  from public.pack_openings o
  join public.pack_products p
    on p.id = o.product_id
  where p.code = 'op12_pack'
    and o.profile_id = (select profile_id from params)
  order by o.created_at desc
  limit (select sample_openings from params)
),
pack_types as (
  select
    pt.value->>'archetype_code' as archetype_code
  from target_openings o
  cross join lateral jsonb_array_elements(
    coalesce(o.result_summary->'pack_types', '[]'::jsonb)
  ) as pt(value)
)
select
  archetype_code,
  count(*) as packs,
  round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 3) as pct
from pack_types
group by archetype_code
order by packs desc, archetype_code;

-- 5) Observed draws bucketed back into configured outcomes for the latest N openings.
with params as (
  select
    'ccc4481c-9faf-483d-8efd-45acb2a33386'::uuid as profile_id,
    500::integer as sample_openings
),
target_openings as (
  select o.*
  from public.pack_openings o
  join public.pack_products p
    on p.id = o.product_id
  where p.code = 'op12_pack'
    and o.profile_id = (select profile_id from params)
  order by o.created_at desc
  limit (select sample_openings from params)
),
pack_types as (
  select
    o.id as opening_id,
    (pt.value->>'pack_index')::integer as pack_index,
    pt.value->>'archetype_code' as archetype_code
  from target_openings o
  cross join lateral jsonb_array_elements(
    coalesce(o.result_summary->'pack_types', '[]'::jsonb)
  ) as pt(value)
),
draws as (
  select
    o.id as opening_id,
    o.created_at,
    pt.archetype_code,
    oc.pack_index,
    oc.slot_order,
    c.card_code,
    c.rarity,
    c.variant
  from target_openings o
  join public.pack_opening_cards oc
    on oc.opening_id = o.id
  join public.pack_cards c
    on c.id = oc.card_id
  left join pack_types pt
    on pt.opening_id = o.id
   and pt.pack_index = oc.pack_index
),
classified as (
  select
    d.*,
    (
      select so.outcome_label
      from public.pack_products p
      join public.pack_product_archetypes a
        on a.product_id = p.id
       and a.code = d.archetype_code
      join public.pack_product_archetype_slot_outcomes so
        on so.archetype_id = a.id
       and so.slot_order = d.slot_order
      where p.code = 'op12_pack'
        and public.pack_card_matches_filters(
          d.rarity,
          d.variant,
          so.rarity_pool,
          so.variant_mode,
          so.variant_include_patterns,
          so.variant_exclude_patterns
        )
      order by so.outcome_order
      limit 1
    ) as matched_outcome_label
  from draws d
)
select
  archetype_code,
  slot_order,
  coalesce(matched_outcome_label, 'UNMATCHED') as outcome_label,
  count(*) as hits,
  round(100.0 * count(*) / nullif(sum(count(*)) over (partition by archetype_code, slot_order), 0), 3) as pct
from classified
group by archetype_code, slot_order, coalesce(matched_outcome_label, 'UNMATCHED')
order by archetype_code, slot_order, hits desc, outcome_label;

-- 6) Optional: open many packs to generate a larger sample.
-- This block checks the current balance before opening anything.
do $$
declare
  v_profile_id uuid := 'ccc4481c-9faf-483d-8efd-45acb2a33386'::uuid;
  v_runs integer := 250;
  v_i integer;
  v_token_cost integer;
  v_balance bigint;
  v_required bigint;
begin
  select token_cost
  into v_token_cost
  from public.pack_products
  where code = 'op12_pack';

  if v_token_cost is null then
    raise exception 'Product op12_pack not found';
  end if;

  select tokens_balance
  into v_balance
  from public.profiles
  where id = v_profile_id;

  if v_balance is null then
    raise exception 'Profile % not found', v_profile_id;
  end if;

  v_required := v_runs::bigint * v_token_cost::bigint;

  if v_balance < v_required then
    raise exception
      'Insufficient tokens for audit run. Current: %, Required: %, Missing: %',
      v_balance,
      v_required,
      v_required - v_balance;
  end if;

  for v_i in 1..v_runs loop
    perform public.open_pack_product_for_profile('op12_pack', v_profile_id);
  end loop;
end;
$$;
