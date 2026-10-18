-- Tests for 063 (Laporan in one call, catalog version without building the menu) on top of 001 to 063.
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
select set_config('request.jwt.claim.sub', :'u2', false);
select (register_business('Kedai Tetangga', 'Outlet Tetangga') ->> 'outlet_id') as o2 \gset
select set_config('request.jwt.claim.sub', :'u1', false);
select (register_business('Kedai Enam Tiga', 'Outlet Satu') ->> 'outlet_id') as o1 \gset
select owner_create_cashier(:'o1', 'Budi', '111111') as c1 \gset
reset role;
insert into products(outlet_id, name, hpp, selling_price, stock, station) values
  (:'o1', 'Kopi', 1000, 5000, 10, 'bar'), (:'o1', 'Teh', 1000, 4000, 10, 'bar');
set role authenticated;

-- Laporan
select owner_report_page(null, now() - interval '1 day', now(), now() - interval '2 days', now() - interval '1 day') as rp \gset
select owner_report(null, now() - interval '1 day', now(), now() - interval '2 days', now() - interval '1 day') as r \gset
select owner_sales_summary(null, now() - interval '1 day', now(), now() - interval '2 days', now() - interval '1 day') as s \gset
select pg_temp.ok('R1 the page carries the whole owner_report', (:'rp'::jsonb - 'sales') = :'r'::jsonb);
select pg_temp.ok('R2 its sales figures match owner_sales_summary', (
  select bool_and(:'rp'::jsonb -> 'sales' -> k = :'s'::jsonb -> k)
  from unnest(array['count', 'sales', 'cash', 'qris', 'refundCount', 'refundTotal', 'voidedCount', 'voidedTotal', 'daily', 'byOutlet', 'byCashier']) k));
select pg_temp.fails('R3 another business''s outlet is refused',
  format($q$select owner_report_page(%L, now() - interval '1 day', now(), now() - interval '2 days', now() - interval '1 day')$q$, :'o2'),
  'Outlet tidak ditemukan');

-- Catalog snapshot
select pos_reference_snapshot(:'o1', null) as s1 \gset
select (:'s1'::jsonb ->> 'version') as v1 \gset
select pg_temp.ok('C1 first call gives the full menu', jsonb_array_length(:'s1'::jsonb -> 'products') = 2 and :'s1'::jsonb ? 'cashiers');
select pg_temp.ok('C2 same version: unchanged, no menu', pos_reference_snapshot(:'o1', :'v1') = jsonb_build_object('version', :'v1', 'unchanged', true));
reset role;
update products set stock = stock - 1 where outlet_id = :'o1' and name = 'Kopi';
set role authenticated;
select pos_reference_snapshot(:'o1', :'v1') as s2 \gset
select pg_temp.ok('C3 a stock change gives a new menu', not (:'s2'::jsonb ? 'unchanged') and :'s2'::jsonb ->> 'version' <> :'v1'
  and (select (x ->> 'stock')::numeric from jsonb_array_elements(:'s2'::jsonb -> 'products') x where x ->> 'name' = 'Kopi') = 9);
select (:'s2'::jsonb ->> 'version') as v2 \gset
reset role;
update products set is_active = false where outlet_id = :'o1' and name = 'Teh';
set role authenticated;
select pg_temp.ok('C4 deactivating a product changes the version', pos_reference_snapshot(:'o1', :'v2') ->> 'version' <> :'v2');
select (pos_reference_snapshot(:'o1', null) ->> 'version') as v3 \gset
reset role;
update outlets set receipt_footer = 'Terima kasih' where id = :'o1';
set role authenticated;
select pg_temp.ok('C5 an outlet text change reaches the phone', pos_reference_snapshot(:'o1', :'v3') ->> 'version' <> :'v3');
select pg_temp.fails('C6 another business''s outlet is refused', format('select pos_reference_snapshot(%L, null)', :'o2'), 'Outlet tidak ditemukan');
reset role;

select pg_temp.ok('C7 anon cannot call the new report function',
  not has_function_privilege('anon', 'public.owner_report_page(uuid, timestamptz, timestamptz, timestamptz, timestamptz)', 'execute'));
