-- Cleanup for the template pack seed and the test data generated from it.
--
-- Important:
-- 1) Update the config block before running it.
-- 2) If you reused the same product codes for real openings later
--    (for example op12_pack / op12_box), this script will remove those
--    openings too. After the card upserts there is no reliable way to
--    separate "template" pulls from later pulls done with the same products.
-- 3) The script recalculates token balances and rebuilds user_collection
--    for affected profiles from the remaining opening history.

begin;

drop table if exists pg_temp.tmp_cleanup_config;
create temp table tmp_cleanup_config as
select
  'OP12'::text as target_set_code,
  array['op12_pack', 'op12_box']::text[] as target_product_codes,
  true::boolean as purge_target_products,
  false::boolean as purge_target_set;

drop table if exists pg_temp.tmp_cleanup_report;
create temp table tmp_cleanup_report (
  step text primary key,
  affected_rows bigint not null default 0
);

drop table if exists pg_temp.tmp_target_products;
create temp table tmp_target_products as
select
  p.id,
  p.set_id,
  p.code,
  p.name,
  p.product_kind
from public.pack_products p
cross join tmp_cleanup_config cfg
where p.code = any(cfg.target_product_codes);

drop table if exists pg_temp.tmp_target_sets;
create temp table tmp_target_sets as
select distinct
  s.id,
  s.code,
  s.name
from public.pack_sets s
cross join tmp_cleanup_config cfg
left join tmp_target_products tp on tp.set_id = s.id
where s.code = cfg.target_set_code
   or tp.id is not null;

drop table if exists pg_temp.tmp_template_cards;
create temp table tmp_template_cards as
select
  c.id,
  c.set_id,
  c.card_code,
  c.card_name,
  c.variant
from public.pack_cards c
join tmp_target_sets ts on ts.id = c.set_id
where c.card_name ilike 'Template %'
   or c.image_url ilike 'https://example.com/%';

drop table if exists pg_temp.tmp_target_openings;
create temp table tmp_target_openings as
select distinct
  o.id,
  o.profile_id,
  o.product_id,
  o.set_id
from public.pack_openings o
where o.product_id in (select id from tmp_target_products)

union

select distinct
  o.id,
  o.profile_id,
  o.product_id,
  o.set_id
from public.pack_openings o
join public.pack_opening_cards oc on oc.opening_id = o.id
join tmp_template_cards tc on tc.id = oc.card_id;

drop table if exists pg_temp.tmp_affected_profiles;
create temp table tmp_affected_profiles as
select distinct profile_id
from tmp_target_openings

union

select distinct uc.profile_id
from public.user_collection uc
join tmp_template_cards tc on tc.id = uc.card_id;

insert into tmp_cleanup_report(step, affected_rows)
values
  ('matched_target_products', (select count(*) from tmp_target_products)),
  ('matched_target_sets', (select count(*) from tmp_target_sets)),
  ('matched_template_cards', (select count(*) from tmp_template_cards)),
  ('matched_target_openings', (select count(*) from tmp_target_openings)),
  ('matched_affected_profiles', (select count(*) from tmp_affected_profiles));

with deleted as (
  delete from public.token_ledger tl
  where tl.source_type = 'product_open'
    and tl.source_id in (select id from tmp_target_openings)
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'delete_token_ledger', count(*) from deleted;

with deleted as (
  delete from public.pack_opening_cards oc
  where oc.opening_id in (select id from tmp_target_openings)
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'delete_pack_opening_cards', count(*) from deleted;

with deleted as (
  delete from public.pack_openings o
  where o.id in (select id from tmp_target_openings)
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'delete_pack_openings', count(*) from deleted;

with updated as (
  update public.token_ledger tl
  set balance_after = balances.new_balance
  from (
    select
      t.id,
      sum(t.delta) over (
        partition by t.profile_id
        order by t.created_at, t.id
        rows between unbounded preceding and current row
      ) as new_balance
    from public.token_ledger t
    where t.profile_id in (select profile_id from tmp_affected_profiles)
  ) balances
  where tl.id = balances.id
    and tl.balance_after is distinct from balances.new_balance
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'recalculate_token_ledger_balances', count(*) from updated;

with updated as (
  update public.profiles p
  set tokens_balance = latest.new_balance
  from (
    select
      ap.profile_id,
      coalesce((
        select tl.balance_after
        from public.token_ledger tl
        where tl.profile_id = ap.profile_id
        order by tl.created_at desc, tl.id desc
        limit 1
      ), 0::bigint) as new_balance
    from tmp_affected_profiles ap
  ) latest
  where p.id = latest.profile_id
    and p.tokens_balance is distinct from latest.new_balance
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'update_profiles_tokens_balance', count(*) from updated;

with deleted as (
  delete from public.user_collection uc
  where uc.profile_id in (select profile_id from tmp_affected_profiles)
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'delete_user_collection_rows', count(*) from deleted;

with rebuilt as (
  insert into public.user_collection(
    profile_id,
    card_id,
    owned_count,
    first_obtained_at,
    last_obtained_at
  )
  select
    o.profile_id,
    oc.card_id,
    count(*)::integer as owned_count,
    min(oc.created_at) as first_obtained_at,
    max(oc.created_at) as last_obtained_at
  from public.pack_openings o
  join public.pack_opening_cards oc on oc.opening_id = o.id
  where o.profile_id in (select profile_id from tmp_affected_profiles)
  group by o.profile_id, oc.card_id
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'rebuild_user_collection_rows', count(*) from rebuilt;

with deleted as (
  delete from public.pack_cards c
  where c.id in (select id from tmp_template_cards)
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'delete_template_pack_cards', count(*) from deleted;

with deleted as (
  delete from public.pack_product_guarantees g
  using tmp_target_products tp, tmp_cleanup_config cfg
  where cfg.purge_target_products is true
    and g.product_id = tp.id
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'delete_pack_product_guarantees', count(*) from deleted;

with deleted as (
  delete from public.pack_product_slots s
  using tmp_target_products tp, tmp_cleanup_config cfg
  where cfg.purge_target_products is true
    and s.product_id = tp.id
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'delete_pack_product_slots', count(*) from deleted;

with deleted as (
  delete from public.pack_products p
  using tmp_target_products tp, tmp_cleanup_config cfg
  where cfg.purge_target_products is true
    and p.id = tp.id
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'delete_pack_products', count(*) from deleted;

with deleted as (
  delete from public.pack_sets s
  using tmp_target_sets ts, tmp_cleanup_config cfg
  where cfg.purge_target_set is true
    and s.id = ts.id
    and not exists (
      select 1
      from public.pack_products p
      where p.set_id = s.id
    )
    and not exists (
      select 1
      from public.pack_cards c
      where c.set_id = s.id
    )
    and not exists (
      select 1
      from public.pack_openings o
      where o.set_id = s.id
    )
  returning 1
)
insert into tmp_cleanup_report(step, affected_rows)
select 'delete_pack_sets', count(*) from deleted;

commit;

select *
from tmp_cleanup_report
order by step;

select
  (select count(*) from public.pack_openings o where o.id in (select id from tmp_target_openings)) as remaining_target_openings,
  (select count(*) from public.pack_cards c where c.id in (select id from tmp_template_cards)) as remaining_template_cards,
  (select count(*) from public.pack_products p where p.id in (select id from tmp_target_products)) as remaining_target_products,
  (select count(*) from public.pack_sets s where s.id in (select id from tmp_target_sets)) as remaining_target_sets;
