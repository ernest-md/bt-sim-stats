-- Pack system foundation for tokens, openings and digital collection.
-- Apply this in Supabase SQL editor before wiring the frontend.

alter table public.profiles
  add column if not exists app_role text not null default 'user';

alter table public.profiles
  add column if not exists tokens_balance bigint not null default 0;

alter table public.profiles
  drop constraint if exists profiles_tokens_balance_check;

alter table public.profiles
  add constraint profiles_tokens_balance_check
  check (tokens_balance >= 0);

create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = p_user_id
      and pr.app_role = 'admin'
  );
$$;

create or replace function public.pack_card_rarity_rank(p_rarity text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(btrim(p_rarity), ''))
    when 'c' then 10
    when 'common' then 10
    when 'don' then 12
    when 'don!!' then 12
    when 'uc' then 20
    when 'uncommon' then 20
    when 'r' then 30
    when 'rare' then 30
    when 'l' then 35
    when 'leader' then 35
    when 'sr' then 40
    when 'super rare' then 40
    when 'sec' then 50
    when 'secret rare' then 50
    when 'sp' then 60
    when 'special' then 60
    when 'tr' then 70
    when 'treasure rare' then 70
    when 'parallel' then 80
    when 'aa' then 85
    when 'alt art' then 85
    when 'manga' then 100
    else 25
  end;
$$;

create table if not exists public.token_ledger (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  delta integer not null check (delta <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reason text not null,
  source_type text not null default 'system'
    check (source_type in ('system', 'admin', 'mission', 'product_open', 'refund')),
  source_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists token_ledger_profile_created_idx
  on public.token_ledger(profile_id, created_at desc);

create table if not exists public.pack_sets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  product_line text not null default 'one_piece',
  release_date date null,
  pack_size integer not null default 12 check (pack_size > 0),
  packs_per_box integer not null default 24 check (packs_per_box > 0),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.pack_cards (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.pack_sets(id) on delete cascade,
  card_code text not null,
  card_name text not null,
  rarity text not null,
  variant text not null default 'base',
  card_type text null,
  image_url text null,
  draw_weight numeric(12,4) not null default 1 check (draw_weight > 0),
  external_source text null,
  external_payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (set_id, card_code, variant)
);

create index if not exists pack_cards_set_rarity_idx
  on public.pack_cards(set_id, rarity, variant);

create table if not exists public.pack_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  set_id uuid not null references public.pack_sets(id) on delete cascade,
  source_pack_product_id uuid null references public.pack_products(id) on delete set null,
  name text not null,
  product_kind text not null
    check (product_kind in ('pack', 'box')),
  token_cost integer not null check (token_cost >= 0),
  pack_count integer not null default 1 check (pack_count > 0),
  is_active boolean not null default true,
  reveal_mode text not null default 'default'
    check (reveal_mode in ('default', 'all_at_once')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (product_kind = 'pack' and source_pack_product_id is null and pack_count = 1)
    or
    (product_kind = 'box' and source_pack_product_id is not null and pack_count > 1)
  )
);

create index if not exists pack_products_set_kind_idx
  on public.pack_products(set_id, product_kind, is_active);

create table if not exists public.pack_product_slots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.pack_products(id) on delete cascade,
  slot_order integer not null check (slot_order > 0),
  slot_label text not null default '',
  picks_per_pack integer not null default 1 check (picks_per_pack > 0),
  rarity_pool text[] not null,
  variant_pool text[] null,
  allow_duplicates boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (product_id, slot_order),
  check (cardinality(rarity_pool) > 0),
  check (variant_pool is null or cardinality(variant_pool) > 0)
);

create table if not exists public.pack_product_guarantees (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.pack_products(id) on delete cascade,
  rarity text not null,
  variant text not null default '*',
  min_count integer not null check (min_count > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (product_id, rarity, variant)
);

create table if not exists public.pack_openings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  set_id uuid not null references public.pack_sets(id) on delete restrict,
  product_id uuid not null references public.pack_products(id) on delete restrict,
  product_code_snapshot text not null,
  product_name_snapshot text not null,
  product_kind text not null,
  pack_count integer not null check (pack_count > 0),
  token_cost integer not null check (token_cost >= 0),
  tokens_balance_after bigint not null check (tokens_balance_after >= 0),
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pack_openings_profile_created_idx
  on public.pack_openings(profile_id, created_at desc);

create index if not exists pack_openings_product_created_idx
  on public.pack_openings(product_id, created_at desc);

create table if not exists public.pack_opening_cards (
  id uuid primary key default gen_random_uuid(),
  opening_id uuid not null references public.pack_openings(id) on delete cascade,
  set_id uuid not null references public.pack_sets(id) on delete restrict,
  pack_index integer not null check (pack_index > 0),
  slot_order integer not null check (slot_order > 0),
  draw_index integer not null check (draw_index > 0),
  card_id uuid not null references public.pack_cards(id) on delete restrict,
  source_kind text not null default 'slot'
    check (source_kind in ('slot', 'guarantee_replacement')),
  created_at timestamptz not null default now(),
  unique (opening_id, pack_index, slot_order, draw_index)
);

create index if not exists pack_opening_cards_opening_idx
  on public.pack_opening_cards(opening_id, pack_index, slot_order, draw_index);

create index if not exists pack_opening_cards_card_idx
  on public.pack_opening_cards(card_id);

create table if not exists public.user_collection (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.pack_cards(id) on delete cascade,
  owned_count integer not null default 0 check (owned_count >= 0),
  first_obtained_at timestamptz not null default now(),
  last_obtained_at timestamptz not null default now(),
  primary key (profile_id, card_id)
);

create index if not exists user_collection_card_idx
  on public.user_collection(card_id);

create or replace function public.add_token_ledger_entry(
  p_profile_id uuid,
  p_delta integer,
  p_reason text,
  p_source_type text default 'system',
  p_source_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_profile_id is null then
    raise exception 'Profile id is required';
  end if;

  if coalesce(p_delta, 0) = 0 then
    raise exception 'Delta cannot be zero';
  end if;

  perform 1
  from public.profiles
  where id = p_profile_id
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  update public.profiles
  set tokens_balance = tokens_balance + p_delta
  where id = p_profile_id
    and tokens_balance + p_delta >= 0
  returning tokens_balance into v_balance;

  if not found then
    raise exception 'Insufficient tokens';
  end if;

  insert into public.token_ledger(
    profile_id,
    delta,
    balance_after,
    reason,
    source_type,
    source_id,
    metadata
  )
  values (
    p_profile_id,
    p_delta,
    v_balance,
    coalesce(nullif(btrim(p_reason), ''), 'system'),
    coalesce(nullif(btrim(p_source_type), ''), 'system'),
    p_source_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return v_balance;
end;
$$;

create or replace function public.admin_adjust_tokens(
  p_target_profile_id uuid,
  p_delta integer,
  p_reason text default 'admin_adjustment',
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if not public.is_admin(auth.uid()) then
      raise exception 'Admin only';
    end if;
  elsif session_user <> 'postgres' then
    raise exception 'Not authenticated';
  end if;

  return public.add_token_ledger_entry(
    p_target_profile_id,
    p_delta,
    coalesce(nullif(btrim(p_reason), ''), 'admin_adjustment'),
    'admin',
    null,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.pick_pack_card(
  p_set_id uuid,
  p_rarity_pool text[],
  p_variant_pool text[] default null,
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
      and c.rarity = any(coalesce(p_rarity_pool, array[]::text[]))
      and (
        p_variant_pool is null
        or c.variant = any(p_variant_pool)
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

revoke all on function public.add_token_ledger_entry(uuid, integer, text, text, uuid, jsonb) from public;
revoke all on function public.admin_adjust_tokens(uuid, integer, text, jsonb) from public;
revoke all on function public.pick_pack_card(uuid, text[], text[], uuid[]) from public;
revoke all on function public.open_pack_product_for_profile(text, uuid) from public;
revoke all on function public.open_pack_product(text) from public;

grant execute on function public.admin_adjust_tokens(uuid, integer, text, jsonb) to authenticated;
grant execute on function public.open_pack_product(text) to authenticated;

alter table public.token_ledger enable row level security;
alter table public.pack_sets enable row level security;
alter table public.pack_cards enable row level security;
alter table public.pack_products enable row level security;
alter table public.pack_product_slots enable row level security;
alter table public.pack_product_guarantees enable row level security;
alter table public.pack_openings enable row level security;
alter table public.pack_opening_cards enable row level security;
alter table public.user_collection enable row level security;

drop policy if exists token_ledger_select_own_or_admin on public.token_ledger;
create policy token_ledger_select_own_or_admin
on public.token_ledger
for select
to authenticated
using (
  profile_id = auth.uid()
  or public.is_admin(auth.uid())
);

drop policy if exists token_ledger_manage_admin_only on public.token_ledger;
create policy token_ledger_manage_admin_only
on public.token_ledger
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists pack_sets_select_authenticated on public.pack_sets;
create policy pack_sets_select_authenticated
on public.pack_sets
for select
to authenticated
using (true);

drop policy if exists pack_sets_manage_admin_only on public.pack_sets;
create policy pack_sets_manage_admin_only
on public.pack_sets
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists pack_cards_select_authenticated on public.pack_cards;
create policy pack_cards_select_authenticated
on public.pack_cards
for select
to authenticated
using (true);

drop policy if exists pack_cards_manage_admin_only on public.pack_cards;
create policy pack_cards_manage_admin_only
on public.pack_cards
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists pack_products_select_authenticated on public.pack_products;
create policy pack_products_select_authenticated
on public.pack_products
for select
to authenticated
using (true);

drop policy if exists pack_products_manage_admin_only on public.pack_products;
create policy pack_products_manage_admin_only
on public.pack_products
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists pack_product_slots_select_authenticated on public.pack_product_slots;
create policy pack_product_slots_select_authenticated
on public.pack_product_slots
for select
to authenticated
using (true);

drop policy if exists pack_product_slots_manage_admin_only on public.pack_product_slots;
create policy pack_product_slots_manage_admin_only
on public.pack_product_slots
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists pack_product_guarantees_select_authenticated on public.pack_product_guarantees;
create policy pack_product_guarantees_select_authenticated
on public.pack_product_guarantees
for select
to authenticated
using (true);

drop policy if exists pack_product_guarantees_manage_admin_only on public.pack_product_guarantees;
create policy pack_product_guarantees_manage_admin_only
on public.pack_product_guarantees
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists pack_openings_select_own_or_admin on public.pack_openings;
create policy pack_openings_select_own_or_admin
on public.pack_openings
for select
to authenticated
using (
  profile_id = auth.uid()
  or public.is_admin(auth.uid())
);

drop policy if exists pack_openings_manage_admin_only on public.pack_openings;
create policy pack_openings_manage_admin_only
on public.pack_openings
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists pack_opening_cards_select_own_or_admin on public.pack_opening_cards;
create policy pack_opening_cards_select_own_or_admin
on public.pack_opening_cards
for select
to authenticated
using (
  exists (
    select 1
    from public.pack_openings o
    where o.id = opening_id
      and (
        o.profile_id = auth.uid()
        or public.is_admin(auth.uid())
      )
  )
);

drop policy if exists pack_opening_cards_manage_admin_only on public.pack_opening_cards;
create policy pack_opening_cards_manage_admin_only
on public.pack_opening_cards
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists user_collection_select_own_or_admin on public.user_collection;
create policy user_collection_select_own_or_admin
on public.user_collection
for select
to authenticated
using (
  profile_id = auth.uid()
  or public.is_admin(auth.uid())
);

drop policy if exists user_collection_manage_admin_only on public.user_collection;
create policy user_collection_manage_admin_only
on public.user_collection
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Useful examples after applying this file:
-- select public.admin_adjust_tokens('<profile-uuid>', 5000, 'seed_tokens');
-- select public.open_pack_product('op12_pack');
-- select public.open_pack_product_for_profile('op12_pack', '<profile-uuid>');
