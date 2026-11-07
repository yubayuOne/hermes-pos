-- Tests for 109 (new plans and the 14-day trial). Every line of output must start with PASS.
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

select pg_temp.ok('P1 Harian pays Rp7.000', public.plan_quote('daily', 0) = 7000);
select pg_temp.ok('P2 Mingguan pays Rp47.000', public.plan_quote('weekly', 0) = 47000);
select pg_temp.ok('P3 Bulanan pays Rp147.000', public.plan_quote('monthly', 0) = 147000);
select pg_temp.ok('P4 Tahunan pays Rp697.000', public.plan_quote('annual', 0) = 697000);
select pg_temp.ok('P5 list prices are the strikethrough prices',
  (select list_price from public.plans where code = 'daily') = 15000
  and (select list_price from public.plans where code = 'weekly') = 100000
  and (select list_price from public.plans where code = 'monthly') = 500000
  and (select list_price from public.plans where code = 'annual') = 1500000);
select pg_temp.ok('P6 two extra outlets on Bulanan: 147.000 + 2 x 99.000', public.plan_quote('monthly', 2) = 147000 + 2 * 99000);
select pg_temp.ok('P7 two extra outlets on Harian: 7.000 + 2 x 3.000', public.plan_quote('daily', 2) = 7000 + 2 * 3000);
select pg_temp.fails('P8 the retired 6-month plan is refused', $q$select public.plan_quote('semiannual', 0)$q$, 'Pilih paket');
select pg_temp.fails('P9 the trial cannot be bought', $q$select public.plan_quote('trial', 0)$q$, 'Pilih paket');
select pg_temp.fails('P10 more than 50 extra outlets is refused', $q$select public.plan_quote('monthly', 51)$q$, 'tidak valid');

insert into auth.users(id, email) values ('10900000-0000-0000-0000-000000000001', 'baru@trial.id');
select set_config('request.jwt.claim.sub', '10900000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Warung Trial', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
reset role;
select pg_temp.ok('P11 a new business gets a 14-day trial',
  (select round(extract(epoch from (expires_at - now())) / 86400.0)::int from public.subscriptions where business_id = current_setting('t.b')::uuid) = 14
  and (select plan_code from public.subscriptions where business_id = current_setting('t.b')::uuid) = 'trial');
