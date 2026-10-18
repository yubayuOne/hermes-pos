-- Tests for 065 (Unlimited plan) on top of 001 to 065. Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
create or replace function pg_temp.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL % (no error)', label;
exception when others then
  raise notice '%', (case when sqlerrm ilike '%' || expect || '%' then 'PASS ' else 'FAIL ' end) || label || ' -> ' || sqlerrm;
end $$;

reset role;
select gen_random_uuid() as u1 \gset
insert into auth.users(id, email) values (:'u1', 'admin065@hermes-pos.test');
set role authenticated;
select set_config('request.jwt.claim.sub', :'u1', false);
select (register_business('Kedai Admin', 'Pusat') ->> 'business_id') as b1 \gset
reset role;

select pg_temp.ok('U1 grant sets Unlimited until 9999', (
  select (r ->> 'plan_code') = 'unlimited' and (r ->> 'expires_at')::timestamptz > '9999-01-01'
  from (select public.admin_grant_unlimited('  ADMIN065@hermes-pos.test ') r) x));
select pg_temp.ok('U2 limits are effectively unlimited', (
  select max_outlets >= 100000 and cashiers_per_outlet >= 100000 and products_per_outlet >= 100000 from public.business_limits(:'b1')));
set role authenticated;
select set_config('request.jwt.claim.sub', :'u1', false);
select pg_temp.ok('U3 status is active, not expired', get_subscription_status() ->> 'state' = 'active');
select pg_temp.fails('U4 Unlimited cannot be quoted for a payment', $q$select plan_quote('unlimited', 0)$q$, 'Pilih paket');
select pg_temp.fails('U5 signed-in users cannot grant it', $q$select admin_grant_unlimited('admin065@hermes-pos.test')$q$, 'permission denied');
reset role;
select pg_temp.fails('U6 a paid activation cannot become Unlimited',
  format($q$select public.admin_activate_subscription(%L, 'unlimited', 0)$q$, :'b1'), 'Paket tidak valid');
select pg_temp.fails('U7 an email without a business is refused', $q$select public.admin_grant_unlimited('nobody@hermes-pos.test')$q$, 'belum punya bisnis');
select pg_temp.ok('U8 paid plans keep their outlet rule', (select plan_quote('monthly', 1) > 0));
set role anon;
select pg_temp.ok('U9 the public plan list does not show Unlimited', not exists (select 1 from public.plans where code = 'unlimited'));
reset role;
