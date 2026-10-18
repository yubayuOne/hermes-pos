-- Tests for 062 (query efficiency) on top of 001 to 062: same rows through the new RLS, the new read functions, grants.
-- Every line of output must start with PASS.
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
select gen_random_uuid() as u2 \gset
insert into auth.users(id) values (:'u1'), (:'u2');
set role authenticated;
select set_config('request.jwt.claim.sub', :'u1', false);
select (register_business('Kedai Enam Dua', 'Outlet Satu') ->> 'outlet_id') as o1 \gset
select set_config('request.jwt.claim.sub', :'u2', false);
select (register_business('Kedai Lain', 'Outlet Dua') ->> 'outlet_id') as o2 \gset
reset role;
insert into products(outlet_id, name, hpp, selling_price, stock, station) values
  (:'o1', 'Kopi', 1000, 5000, 10, 'bar'), (:'o1', 'Teh', 1000, 4000, 10, 'bar'), (:'o2', 'Roti', 2000, 8000, 10, 'kitchen');

set role authenticated;
select set_config('request.jwt.claim.sub', :'u1', false);
select pg_temp.ok('E1 the owner reads only their own products', (select count(*) from products where outlet_id in (:'o1', :'o2')) = 2);
select pg_temp.ok('E2 the owner reads only their own outlets', (select count(*) from outlets where id in (:'o1', :'o2')) = 1);
select pg_temp.ok('E3 shell counts are per business', (owner_shell_counts() ->> 'products')::int = 2 and (owner_shell_counts() ->> 'vouchers')::int = 0);
select owner_dashboard(null, now() - interval '1 day', now(), now() - interval '2 days', now() - interval '1 day',
  now() - interval '6 days', now() - interval '1 hour', now() + interval '1 day') as d \gset
select pg_temp.ok('E4 dashboard: period, week, today in one result',
  (:'d'::jsonb -> 'period' ->> 'sales')::numeric = 0 and jsonb_typeof(:'d'::jsonb -> 'week' -> 'daily') = 'array'
  and jsonb_typeof(:'d'::jsonb -> 'today' -> 'hourly') = 'array');
select pg_temp.ok('E5 dashboard carries the expenses and sales after them',
  (:'d'::jsonb -> 'period' -> 'expenses' ->> 'drawer')::numeric = 0 and (:'d'::jsonb -> 'period' ->> 'salesAfterExpenses')::numeric = 0);
select pg_temp.ok('E6 no closed shift yet gives no variance', :'d'::jsonb -> 'lastVariance' = 'null'::jsonb);
select pg_temp.fails('E7 another business''s outlet is refused',
  format($q$select owner_dashboard(%L, now() - interval '1 day', now(), now() - interval '2 days', now() - interval '1 day',
    now() - interval '6 days', now() - interval '1 hour', now() + interval '1 day')$q$, :'o2'), 'Outlet tidak ditemukan');
select pg_temp.fails('E8 a chart window longer than 8 days is refused',
  $q$select owner_dashboard(null, now() - interval '1 day', now(), now() - interval '2 days', now() - interval '1 day',
    now() - interval '30 days', now() - interval '1 hour', now() + interval '1 day')$q$, 'Rentang tanggal tidak valid');
select pg_temp.ok('E9 056 still answers with expenses', (owner_summary_with_expenses(null, now() - interval '1 day', now(),
  now() - interval '2 days', now() - interval '1 day') -> 'expenses' ->> 'total')::numeric = 0);

select set_config('request.jwt.claim.sub', :'u2', false);
select pg_temp.ok('E10 the second owner sees their own product only', (select count(*) from products where outlet_id in (:'o1', :'o2')) = 1);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok('E11 signed out sees no products', (select count(*) from products) = 0);
reset role;

select pg_temp.ok('E12 anon cannot call the new owner functions',
  not has_function_privilege('anon', 'public.owner_dashboard(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.owner_shell_counts()', 'execute'));
select pg_temp.ok('E13 internal functions are not callable by clients',
  not has_function_privilege('authenticated', 'public.owner_expense_totals(uuid, uuid, timestamptz, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.cleanup_checkout_idempotency()', 'execute'));
select pg_temp.ok('E14 owner policies test the outlet set, not a function per row',
  (select count(*) from pg_policies where schemaname = 'public' and qual like '%my_owner_outlet_ids%') = 7
  and not exists (select 1 from pg_policies where schemaname = 'public' and qual like '%is_owner_of_outlet%'));
select pg_temp.ok('E15 no policy calls auth.uid() per row', not exists (
  select 1 from pg_policies where schemaname = 'public' and qual ~ 'auth\.uid\(\)' and qual !~ 'SELECT auth\.uid\(\)'));
select pg_temp.ok('E16 the new indexes exist', (select count(*) from pg_indexes where indexname in
  ('cashier_sessions_cashier', 'shifts_outlet_closed', 'checkout_idempotency_created')) = 3);
select pg_temp.ok('E17 the idempotency cleanup runs', public.cleanup_checkout_idempotency() >= 0);
