-- Minimal patch to add SQL-editor testing support for the pack system.
-- Run this only after pack_system.sql has been applied successfully.

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
    select greatest(
      v_guarantee.min_count - count(*),
      0
    )
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
        case
          when v_guarantee.variant = '*' then null
          else array[v_guarantee.variant]
        end,
        v_excluded_card_ids
      );

      if v_card_id is null then
        v_card_id := public.pick_pack_card(
          v_product.set_id,
          array[v_guarantee.rarity],
          case
            when v_guarantee.variant = '*' then null
            else array[v_guarantee.variant]
          end,
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

  insert into public.user_collection(
    profile_id,
    card_id,
    owned_count,
    first_obtained_at,
    last_obtained_at
  )
  select
    v_user_id,
    oc.card_id,
    count(*)::integer,
    now(),
    now()
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
        select
          c.rarity,
          count(*)::integer as total
        from public.pack_opening_cards oc
        join public.pack_cards c on c.id = oc.card_id
        where oc.opening_id = v_opening_id
        group by c.rarity
      ) x
    ), '{}'::jsonb),
    'by_variant', coalesce((
      select jsonb_object_agg(x.variant, x.total)
      from (
        select
          c.variant,
          count(*)::integer as total
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

revoke all on function public.open_pack_product_for_profile(text, uuid) from public;
revoke all on function public.open_pack_product(text) from public;

grant execute on function public.open_pack_product(text) to authenticated;
