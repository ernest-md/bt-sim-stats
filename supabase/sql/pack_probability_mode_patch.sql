-- Pocket-like probability mode for pack openings.
--
-- What this adds:
-- - product-level pack archetypes (normal pack, god pack, +1 pack, etc.)
-- - slot outcome probabilities per archetype
-- - a new probability-based opening path without box guarantees
-- - backward compatibility: if a product has no archetypes configured,
--   the legacy slot + guarantee logic continues to be used

begin;

create table if not exists public.pack_product_archetypes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.pack_products(id) on delete cascade,
  code text not null,
  label text not null default '',
  weight numeric(12,6) not null check (weight > 0),
  card_count integer not null check (card_count > 0),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (product_id, code)
);

create index if not exists pack_product_archetypes_product_idx
  on public.pack_product_archetypes(product_id, is_active, weight desc);

create table if not exists public.pack_product_archetype_slot_outcomes (
  id uuid primary key default gen_random_uuid(),
  archetype_id uuid not null references public.pack_product_archetypes(id) on delete cascade,
  slot_order integer not null check (slot_order > 0),
  outcome_order integer not null check (outcome_order > 0),
  outcome_label text not null default '',
  probability_weight numeric(12,6) not null check (probability_weight > 0),
  rarity_pool text[] null,
  variant_mode text not null default 'any'
    check (variant_mode in ('any', 'base_only', 'non_base_only')),
  variant_include_patterns text[] null,
  variant_exclude_patterns text[] null,
  allow_duplicates boolean not null default true,
  max_matches_per_pack integer null check (max_matches_per_pack > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (archetype_id, slot_order, outcome_order),
  check (rarity_pool is null or cardinality(rarity_pool) > 0),
  check (variant_include_patterns is null or cardinality(variant_include_patterns) > 0),
  check (variant_exclude_patterns is null or cardinality(variant_exclude_patterns) > 0)
);

create index if not exists pack_product_archetype_slot_outcomes_arch_slot_idx
  on public.pack_product_archetype_slot_outcomes(archetype_id, slot_order, probability_weight desc);

create or replace function public.pack_card_matches_filters(
  p_card_rarity text,
  p_card_variant text,
  p_rarity_pool text[] default null,
  p_variant_mode text default 'any',
  p_variant_include_patterns text[] default null,
  p_variant_exclude_patterns text[] default null
)
returns boolean
language sql
immutable
as $$
  select
    (
      p_rarity_pool is null
      or cardinality(p_rarity_pool) = 0
      or p_card_rarity = any(p_rarity_pool)
    )
    and (
      case lower(coalesce(p_variant_mode, 'any'))
        when 'base_only' then coalesce(p_card_variant, 'base') = 'base'
        when 'non_base_only' then coalesce(p_card_variant, 'base') <> 'base'
        else true
      end
    )
    and (
      p_variant_include_patterns is null
      or cardinality(p_variant_include_patterns) = 0
      or exists (
        select 1
        from unnest(p_variant_include_patterns) as pattern
        where coalesce(p_card_variant, '') ilike pattern
      )
    )
    and (
      p_variant_exclude_patterns is null
      or cardinality(p_variant_exclude_patterns) = 0
      or not exists (
        select 1
        from unnest(p_variant_exclude_patterns) as pattern
        where coalesce(p_card_variant, '') ilike pattern
      )
    );
$$;

create or replace function public.pick_pack_card_advanced(
  p_set_id uuid,
  p_rarity_pool text[] default null,
  p_variant_mode text default 'any',
  p_variant_include_patterns text[] default null,
  p_variant_exclude_patterns text[] default null,
  p_excluded_card_ids uuid[] default null
)
returns uuid
language sql
volatile
set search_path = public
as $$
  with candidates as (
    select
      c.id,
      c.draw_weight
    from public.pack_cards c
    where c.set_id = p_set_id
      and c.is_active = true
      and public.pack_card_matches_filters(
        c.rarity,
        c.variant,
        p_rarity_pool,
        p_variant_mode,
        p_variant_include_patterns,
        p_variant_exclude_patterns
      )
      and (
        coalesce(cardinality(p_excluded_card_ids), 0) = 0
        or not (c.id = any(p_excluded_card_ids))
      )
  )
  select id
  from candidates
  order by (-ln(greatest(random(), 1e-12::double precision)) / greatest(draw_weight::double precision, 0.0001))
  limit 1;
$$;

create or replace function public.pick_pack_archetype(
  p_product_id uuid
)
returns uuid
language sql
volatile
set search_path = public
as $$
  with candidates as (
    select
      a.id,
      a.weight
    from public.pack_product_archetypes a
    where a.product_id = p_product_id
      and a.is_active = true
  )
  select id
  from candidates
  order by (-ln(greatest(random(), 1e-12::double precision)) / greatest(weight::double precision, 0.0001))
  limit 1;
$$;

create or replace function public.pick_pack_archetype_slot_outcome(
  p_archetype_id uuid,
  p_opening_id uuid,
  p_pack_index integer,
  p_slot_order integer
)
returns uuid
language sql
volatile
set search_path = public
as $$
  with eligible as (
    select
      o.id,
      o.probability_weight
    from public.pack_product_archetype_slot_outcomes o
    where o.archetype_id = p_archetype_id
      and o.slot_order = p_slot_order
      and (
        o.max_matches_per_pack is null
        or (
          select count(*)
          from public.pack_opening_cards oc
          join public.pack_cards c on c.id = oc.card_id
          where oc.opening_id = p_opening_id
            and oc.pack_index = p_pack_index
            and public.pack_card_matches_filters(
              c.rarity,
              c.variant,
              o.rarity_pool,
              o.variant_mode,
              o.variant_include_patterns,
              o.variant_exclude_patterns
            )
        ) < o.max_matches_per_pack
      )
  )
  select id
  from eligible
  order by (-ln(greatest(random(), 1e-12::double precision)) / greatest(probability_weight::double precision, 0.0001))
  limit 1;
$$;

create or replace function public.open_pack_product_legacy_for_profile(
  p_product_code text,
  p_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := p_profile_id;
  v_product record;
  v_slot record;
  v_guarantee record;
  v_opening_id uuid := gen_random_uuid();
  v_balance_after bigint;
  v_pack_index integer;
  v_draw_index integer;
  v_card_id uuid;
  v_needed integer;
  v_excluded_card_ids uuid[];
  v_summary jsonb;
begin
  if v_user_id is null then
    raise exception 'Profile id is required';
  end if;

  if auth.uid() is not null then
    if auth.uid() <> v_user_id and not public.is_admin(auth.uid()) then
      raise exception 'Forbidden profile id';
    end if;
  elsif session_user <> 'postgres' then
    raise exception 'Not authenticated';
  end if;

  select
    p.id,
    p.code,
    p.name,
    p.set_id,
    p.product_kind,
    p.token_cost,
    p.pack_count,
    p.is_active,
    p.source_pack_product_id,
    coalesce(sp.id, p.id) as base_pack_product_id,
    coalesce(sp.product_kind, p.product_kind) as base_pack_kind,
    coalesce(sp.set_id, p.set_id) as base_pack_set_id
  into v_product
  from public.pack_products p
  left join public.pack_products sp
    on sp.id = p.source_pack_product_id
  where p.code = btrim(coalesce(p_product_code, ''))
  limit 1;

  if not found then
    raise exception 'Unknown product code';
  end if;

  if v_product.is_active is not true then
    raise exception 'Product is not active';
  end if;

  if v_product.base_pack_kind <> 'pack' then
    raise exception 'Base pack product is invalid';
  end if;

  if v_product.base_pack_set_id <> v_product.set_id then
    raise exception 'Product set mismatch';
  end if;

  if not exists (
    select 1
    from public.pack_product_slots s
    where s.product_id = v_product.base_pack_product_id
  ) then
    raise exception 'No slot rules found for product';
  end if;

  v_balance_after := public.add_token_ledger_entry(
    v_user_id,
    -v_product.token_cost,
    'open_pack_product',
    'product_open',
    v_opening_id,
    jsonb_build_object(
      'product_code', v_product.code,
      'product_kind', v_product.product_kind
    )
  );

  insert into public.pack_openings(
    id,
    profile_id,
    set_id,
    product_id,
    product_code_snapshot,
    product_name_snapshot,
    product_kind,
    pack_count,
    token_cost,
    tokens_balance_after
  )
  values (
    v_opening_id,
    v_user_id,
    v_product.set_id,
    v_product.id,
    v_product.code,
    v_product.name,
    v_product.product_kind,
    v_product.pack_count,
    v_product.token_cost,
    v_balance_after
  );

  for v_pack_index in 1..v_product.pack_count loop
    for v_slot in
      select
        s.slot_order,
        s.slot_label,
        s.picks_per_pack,
        s.rarity_pool,
        s.variant_pool,
        s.allow_duplicates
      from public.pack_product_slots s
      where s.product_id = v_product.base_pack_product_id
      order by s.slot_order
    loop
      for v_draw_index in 1..v_slot.picks_per_pack loop
        if v_slot.allow_duplicates then
          v_excluded_card_ids := null;
        else
          select array_agg(oc.card_id order by oc.slot_order, oc.draw_index)
          into v_excluded_card_ids
          from public.pack_opening_cards oc
          where oc.opening_id = v_opening_id
            and oc.pack_index = v_pack_index;
        end if;

        v_card_id := public.pick_pack_card(
          v_product.set_id,
          v_slot.rarity_pool,
          v_slot.variant_pool,
          v_excluded_card_ids
        );

        if v_card_id is null and v_slot.allow_duplicates is false then
          v_card_id := public.pick_pack_card(
            v_product.set_id,
            v_slot.rarity_pool,
            v_slot.variant_pool,
            null
          );
        end if;

        if v_card_id is null then
          raise exception 'No card candidate found for slot %', v_slot.slot_order;
        end if;

        insert into public.pack_opening_cards(
          opening_id,
          set_id,
          pack_index,
          slot_order,
          draw_index,
          card_id,
          source_kind
        )
        values (
          v_opening_id,
          v_product.set_id,
          v_pack_index,
          v_slot.slot_order,
          v_draw_index,
          v_card_id,
          'slot'
        );
      end loop;
    end loop;
  end loop;

  for v_guarantee in
    select
      g.rarity,
      g.variant,
      g.min_count
    from public.pack_product_guarantees g
    where g.product_id = v_product.id
    order by public.pack_card_rarity_rank(g.rarity) desc, g.min_count desc
  loop
    select greatest(v_guarantee.min_count - count(*), 0)
    into v_needed
    from public.pack_opening_cards oc
    join public.pack_cards c on c.id = oc.card_id
    where oc.opening_id = v_opening_id
      and c.rarity = v_guarantee.rarity
      and (v_guarantee.variant = '*' or c.variant = v_guarantee.variant);

    while v_needed > 0 loop
      select array_agg(oc.card_id)
      into v_excluded_card_ids
      from public.pack_opening_cards oc
      where oc.opening_id = v_opening_id;

      v_card_id := public.pick_pack_card(
        v_product.set_id,
        array[v_guarantee.rarity],
        case when v_guarantee.variant = '*' then null else array[v_guarantee.variant] end,
        v_excluded_card_ids
      );

      if v_card_id is null then
        v_card_id := public.pick_pack_card(
          v_product.set_id,
          array[v_guarantee.rarity],
          case when v_guarantee.variant = '*' then null else array[v_guarantee.variant] end,
          null
        );
      end if;

      if v_card_id is null then
        raise exception 'No card candidate found for guarantee % / %', v_guarantee.rarity, v_guarantee.variant;
      end if;

      update public.pack_opening_cards oc
      set
        card_id = v_card_id,
        source_kind = 'guarantee_replacement'
      where oc.id = (
        select oc2.id
        from public.pack_opening_cards oc2
        join public.pack_cards c2 on c2.id = oc2.card_id
        where oc2.opening_id = v_opening_id
          and not (
            c2.rarity = v_guarantee.rarity
            and (v_guarantee.variant = '*' or c2.variant = v_guarantee.variant)
          )
        order by public.pack_card_rarity_rank(c2.rarity) asc, random()
        limit 1
      );

      if not found then
        raise exception 'Could not apply guarantee % / %', v_guarantee.rarity, v_guarantee.variant;
      end if;

      v_needed := v_needed - 1;
    end loop;
  end loop;

  insert into public.user_collection(profile_id, card_id, owned_count, first_obtained_at, last_obtained_at)
  select v_user_id, oc.card_id, count(*)::integer, now(), now()
  from public.pack_opening_cards oc
  where oc.opening_id = v_opening_id
  group by oc.card_id
  on conflict (profile_id, card_id) do update
  set
    owned_count = public.user_collection.owned_count + excluded.owned_count,
    last_obtained_at = excluded.last_obtained_at;

  select jsonb_build_object(
    'total_cards', coalesce((select count(*) from public.pack_opening_cards oc where oc.opening_id = v_opening_id), 0),
    'by_rarity', coalesce((
      select jsonb_object_agg(x.rarity, x.total)
      from (
        select c.rarity, count(*)::integer as total
        from public.pack_opening_cards oc
        join public.pack_cards c on c.id = oc.card_id
        where oc.opening_id = v_opening_id
        group by c.rarity
      ) x
    ), '{}'::jsonb),
    'by_variant', coalesce((
      select jsonb_object_agg(x.variant, x.total)
      from (
        select c.variant, count(*)::integer as total
        from public.pack_opening_cards oc
        join public.pack_cards c on c.id = oc.card_id
        where oc.opening_id = v_opening_id
        group by c.variant
      ) x
    ), '{}'::jsonb)
  )
  into v_summary;

  update public.pack_openings
  set result_summary = coalesce(v_summary, '{}'::jsonb)
  where id = v_opening_id;

  return (
    select jsonb_build_object(
      'opening_id', o.id,
      'product_code', o.product_code_snapshot,
      'product_name', o.product_name_snapshot,
      'product_kind', o.product_kind,
      'pack_count', o.pack_count,
      'token_cost', o.token_cost,
      'tokens_balance_after', o.tokens_balance_after,
      'created_at', o.created_at,
      'summary', o.result_summary,
      'cards', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'pack_index', oc.pack_index,
            'slot_order', oc.slot_order,
            'draw_index', oc.draw_index,
            'source_kind', oc.source_kind,
            'card_id', c.id,
            'card_code', c.card_code,
            'card_name', c.card_name,
            'rarity', c.rarity,
            'variant', c.variant,
            'card_type', c.card_type,
            'image_url', c.image_url
          )
          order by oc.pack_index, oc.slot_order, oc.draw_index
        )
        from public.pack_opening_cards oc
        join public.pack_cards c on c.id = oc.card_id
        where oc.opening_id = o.id
      ), '[]'::jsonb)
    )
    from public.pack_openings o
    where o.id = v_opening_id
  );
end;
$$;

create or replace function public.open_pack_product_probability_for_profile(
  p_product_code text,
  p_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := p_profile_id;
  v_product record;
  v_opening_id uuid := gen_random_uuid();
  v_balance_after bigint;
  v_pack_index integer;
  v_slot_order integer;
  v_archetype_id uuid;
  v_outcome_id uuid;
  v_archetype record;
  v_outcome record;
  v_card_id uuid;
  v_excluded_card_ids uuid[];
  v_summary jsonb;
  v_pack_types jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Profile id is required';
  end if;

  if auth.uid() is not null then
    if auth.uid() <> v_user_id and not public.is_admin(auth.uid()) then
      raise exception 'Forbidden profile id';
    end if;
  elsif session_user <> 'postgres' then
    raise exception 'Not authenticated';
  end if;

  select
    p.id,
    p.code,
    p.name,
    p.set_id,
    p.product_kind,
    p.token_cost,
    p.pack_count,
    p.is_active,
    coalesce(sp.id, p.id) as base_pack_product_id,
    coalesce(sp.product_kind, p.product_kind) as base_pack_kind,
    coalesce(sp.set_id, p.set_id) as base_pack_set_id
  into v_product
  from public.pack_products p
  left join public.pack_products sp
    on sp.id = p.source_pack_product_id
  where p.code = btrim(coalesce(p_product_code, ''))
  limit 1;

  if not found then
    raise exception 'Unknown product code';
  end if;

  if v_product.is_active is not true then
    raise exception 'Product is not active';
  end if;

  if v_product.base_pack_kind <> 'pack' then
    raise exception 'Base pack product is invalid';
  end if;

  if v_product.base_pack_set_id <> v_product.set_id then
    raise exception 'Product set mismatch';
  end if;

  if not exists (
    select 1
    from public.pack_product_archetypes a
    where a.product_id = v_product.base_pack_product_id
      and a.is_active = true
  ) then
    raise exception 'No archetype rules found for product';
  end if;

  v_balance_after := public.add_token_ledger_entry(
    v_user_id,
    -v_product.token_cost,
    'open_pack_product',
    'product_open',
    v_opening_id,
    jsonb_build_object(
      'product_code', v_product.code,
      'product_kind', v_product.product_kind
    )
  );

  insert into public.pack_openings(
    id,
    profile_id,
    set_id,
    product_id,
    product_code_snapshot,
    product_name_snapshot,
    product_kind,
    pack_count,
    token_cost,
    tokens_balance_after
  )
  values (
    v_opening_id,
    v_user_id,
    v_product.set_id,
    v_product.id,
    v_product.code,
    v_product.name,
    v_product.product_kind,
    v_product.pack_count,
    v_product.token_cost,
    v_balance_after
  );

  for v_pack_index in 1..v_product.pack_count loop
    v_archetype_id := public.pick_pack_archetype(v_product.base_pack_product_id);

    if v_archetype_id is null then
      raise exception 'No active archetype candidate found for product';
    end if;

    select *
    into v_archetype
    from public.pack_product_archetypes
    where id = v_archetype_id;

    v_pack_types := v_pack_types || jsonb_build_array(
      jsonb_build_object(
        'pack_index', v_pack_index,
        'archetype_code', v_archetype.code,
        'archetype_label', v_archetype.label,
        'card_count', v_archetype.card_count
      )
    );

    for v_slot_order in 1..v_archetype.card_count loop
      v_outcome_id := public.pick_pack_archetype_slot_outcome(
        v_archetype.id,
        v_opening_id,
        v_pack_index,
        v_slot_order
      );

      if v_outcome_id is null then
        raise exception 'No outcome candidate found for archetype % slot %', v_archetype.code, v_slot_order;
      end if;

      select *
      into v_outcome
      from public.pack_product_archetype_slot_outcomes
      where id = v_outcome_id;

      if v_outcome.allow_duplicates then
        v_excluded_card_ids := null;
      else
        select array_agg(oc.card_id order by oc.slot_order, oc.draw_index)
        into v_excluded_card_ids
        from public.pack_opening_cards oc
        where oc.opening_id = v_opening_id
          and oc.pack_index = v_pack_index;
      end if;

      v_card_id := public.pick_pack_card_advanced(
        v_product.set_id,
        v_outcome.rarity_pool,
        v_outcome.variant_mode,
        v_outcome.variant_include_patterns,
        v_outcome.variant_exclude_patterns,
        v_excluded_card_ids
      );

      if v_card_id is null and v_outcome.allow_duplicates is false then
        v_card_id := public.pick_pack_card_advanced(
          v_product.set_id,
          v_outcome.rarity_pool,
          v_outcome.variant_mode,
          v_outcome.variant_include_patterns,
          v_outcome.variant_exclude_patterns,
          null
        );
      end if;

      if v_card_id is null then
        raise exception 'No card candidate found for archetype % slot %', v_archetype.code, v_slot_order;
      end if;

      insert into public.pack_opening_cards(
        opening_id,
        set_id,
        pack_index,
        slot_order,
        draw_index,
        card_id,
        source_kind
      )
      values (
        v_opening_id,
        v_product.set_id,
        v_pack_index,
        v_slot_order,
        1,
        v_card_id,
        'slot'
      );
    end loop;
  end loop;

  insert into public.user_collection(profile_id, card_id, owned_count, first_obtained_at, last_obtained_at)
  select v_user_id, oc.card_id, count(*)::integer, now(), now()
  from public.pack_opening_cards oc
  where oc.opening_id = v_opening_id
  group by oc.card_id
  on conflict (profile_id, card_id) do update
  set
    owned_count = public.user_collection.owned_count + excluded.owned_count,
    last_obtained_at = excluded.last_obtained_at;

  select jsonb_build_object(
    'total_cards', coalesce((select count(*) from public.pack_opening_cards oc where oc.opening_id = v_opening_id), 0),
    'pack_types', coalesce(v_pack_types, '[]'::jsonb),
    'by_rarity', coalesce((
      select jsonb_object_agg(x.rarity, x.total)
      from (
        select c.rarity, count(*)::integer as total
        from public.pack_opening_cards oc
        join public.pack_cards c on c.id = oc.card_id
        where oc.opening_id = v_opening_id
        group by c.rarity
      ) x
    ), '{}'::jsonb),
    'by_variant', coalesce((
      select jsonb_object_agg(x.variant, x.total)
      from (
        select c.variant, count(*)::integer as total
        from public.pack_opening_cards oc
        join public.pack_cards c on c.id = oc.card_id
        where oc.opening_id = v_opening_id
        group by c.variant
      ) x
    ), '{}'::jsonb)
  )
  into v_summary;

  update public.pack_openings
  set result_summary = coalesce(v_summary, '{}'::jsonb)
  where id = v_opening_id;

  return (
    select jsonb_build_object(
      'opening_id', o.id,
      'product_code', o.product_code_snapshot,
      'product_name', o.product_name_snapshot,
      'product_kind', o.product_kind,
      'pack_count', o.pack_count,
      'token_cost', o.token_cost,
      'tokens_balance_after', o.tokens_balance_after,
      'created_at', o.created_at,
      'summary', o.result_summary,
      'cards', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'pack_index', oc.pack_index,
            'slot_order', oc.slot_order,
            'draw_index', oc.draw_index,
            'source_kind', oc.source_kind,
            'card_id', c.id,
            'card_code', c.card_code,
            'card_name', c.card_name,
            'rarity', c.rarity,
            'variant', c.variant,
            'card_type', c.card_type,
            'image_url', c.image_url
          )
          order by oc.pack_index, oc.slot_order, oc.draw_index
        )
        from public.pack_opening_cards oc
        join public.pack_cards c on c.id = oc.card_id
        where oc.opening_id = o.id
      ), '[]'::jsonb)
    )
    from public.pack_openings o
    where o.id = v_opening_id
  );
end;
$$;

create or replace function public.open_pack_product_for_profile(
  p_product_code text,
  p_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_pack_product_id uuid;
begin
  select coalesce(sp.id, p.id)
  into v_base_pack_product_id
  from public.pack_products p
  left join public.pack_products sp
    on sp.id = p.source_pack_product_id
  where p.code = btrim(coalesce(p_product_code, ''))
  limit 1;

  if v_base_pack_product_id is not null and exists (
    select 1
    from public.pack_product_archetypes a
    where a.product_id = v_base_pack_product_id
      and a.is_active = true
  ) then
    return public.open_pack_product_probability_for_profile(p_product_code, p_profile_id);
  end if;

  return public.open_pack_product_legacy_for_profile(p_product_code, p_profile_id);
end;
$$;

create or replace function public.open_pack_product(
  p_product_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  return public.open_pack_product_for_profile(p_product_code, auth.uid());
end;
$$;

revoke all on function public.pack_card_matches_filters(text, text, text[], text, text[], text[]) from public;
revoke all on function public.pick_pack_card_advanced(uuid, text[], text, text[], text[], uuid[]) from public;
revoke all on function public.pick_pack_archetype(uuid) from public;
revoke all on function public.pick_pack_archetype_slot_outcome(uuid, uuid, integer, integer) from public;
revoke all on function public.open_pack_product_legacy_for_profile(text, uuid) from public;
revoke all on function public.open_pack_product_probability_for_profile(text, uuid) from public;
revoke all on function public.open_pack_product_for_profile(text, uuid) from public;
revoke all on function public.open_pack_product(text) from public;

grant execute on function public.open_pack_product(text) to authenticated;

alter table public.pack_product_archetypes enable row level security;
alter table public.pack_product_archetype_slot_outcomes enable row level security;

drop policy if exists pack_product_archetypes_select_authenticated on public.pack_product_archetypes;
create policy pack_product_archetypes_select_authenticated
on public.pack_product_archetypes
for select
to authenticated
using (true);

drop policy if exists pack_product_archetypes_manage_admin_only on public.pack_product_archetypes;
create policy pack_product_archetypes_manage_admin_only
on public.pack_product_archetypes
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists pack_product_archetype_slot_outcomes_select_authenticated on public.pack_product_archetype_slot_outcomes;
create policy pack_product_archetype_slot_outcomes_select_authenticated
on public.pack_product_archetype_slot_outcomes
for select
to authenticated
using (true);

drop policy if exists pack_product_archetype_slot_outcomes_manage_admin_only on public.pack_product_archetype_slot_outcomes;
create policy pack_product_archetype_slot_outcomes_manage_admin_only
on public.pack_product_archetype_slot_outcomes
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

commit;

-- Examples after applying this patch:
-- select public.open_pack_product('op12_pack');
-- select public.open_pack_product_for_profile('op12_pack', '<profile-uuid>');
