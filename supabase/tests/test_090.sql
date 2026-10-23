-- Tests for 090 (link visible on the purchase line; the item lock stays within the outlet). Every line of output must start with PASS.
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
create or replace function pg_temp.ing(o text, n text) returns text language sql security definer as $$
  select id::text from public.ingredients where outlet_id = o::uuid and name = n
$$;
create or replace function pg_temp.item_id(n text) returns text language sql security definer as $$
  select id::text from public.expense_items where name = n
$$;
create or replace function pg_temp.purchases() returns bigint language sql security definer as $$
  select count(*) from public.purchases
$$;
create or replace function pg_temp.linked(item text) returns bigint language sql security definer as $$
  select count(*) from public.purchase_lines where expense_item_id = pg_temp.item_id(item)::uuid
$$;

-- ================================================================ fixture: one business, two outlets
insert into auth.users(id, email) values ('e9000000-0000-0000-0000-000000000001', 'lihat@kopi.id');
select set_config('request.jwt.claim.sub', 'e9000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Lihat', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days', extra_outlets = 1 where business_id = current_setting('t.b')::uuid;
set role authenticated;
select set_config('t.o2', public.owner_create_outlet('Cabang')::text, false);
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Lihat', '123456');
select public.owner_create_cashier(current_setting('t.o2')::uuid, 'Cabang', '654321');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Lihat'), false);
select set_config('t.c2', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Cabang'), false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);
select set_config('t.sh2', public.open_shift(current_setting('t.c2')::uuid, current_setting('t.o2')::uuid, 100000)::text, false);
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'SKM', 18000, 370, 'g', 'kaleng');
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'Kopi', 120000, 1, 'kg');
select public.record_expense(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, 'drawer',
  jsonb_build_array(jsonb_build_object('name', 'Beli SKM', 'category', 'belanja', 'quantity', 1, 'unit', 'pcs', 'amount', 36000)), 'v-1');
select public.record_expense(current_setting('t.sh2')::uuid, current_setting('t.c2')::uuid, current_setting('t.o2')::uuid, 'drawer',
  jsonb_build_array(jsonb_build_object('name', 'Beli cabang', 'category', 'belanja', 'quantity', 1, 'unit', 'pcs', 'amount', 20000)), 'v-2');
select pg_temp.ok('F1 fixture: two outlets, one item each', pg_temp.item_id('Beli SKM') is not null and pg_temp.item_id('Beli cabang') is not null);

-- ================================================================ P1 the line shows its expense item
select public.owner_link_expense_items(current_setting('t.o')::uuid, jsonb_build_array(jsonb_build_object(
  'expenseItemId', pg_temp.item_id('Beli SKM'), 'ingredientId', pg_temp.ing(current_setting('t.o'), 'SKM'), 'packs', 2)));
select public.owner_save_purchase(current_setting('t.o')::uuid, (select business_date from public.shifts where id = current_setting('t.sh')::uuid),
  jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing(current_setting('t.o'), 'Kopi'), 'packs', 1, 'total', 110000)));
select set_config('t.list', public.owner_list_purchases(current_setting('t.o')::uuid)::text, false);
select pg_temp.ok('P1a a linked line carries expenseItemId',
  (select l ->> 'expenseItemId' from jsonb_array_elements(current_setting('t.list')::jsonb -> 'rows') r, jsonb_array_elements(r -> 'lines') l
   where l ->> 'name' = 'SKM') = pg_temp.item_id('Beli SKM'));
select pg_temp.ok('P1b an owner-paid line has expenseItemId null',
  (select l -> 'expenseItemId' from jsonb_array_elements(current_setting('t.list')::jsonb -> 'rows') r, jsonb_array_elements(r -> 'lines') l
   where l ->> 'name' = 'Kopi') = 'null'::jsonb);
select pg_temp.ok('P1c the list shape is otherwise unchanged',
  (select array_agg(k order by k) from jsonb_object_keys(current_setting('t.list')::jsonb) k) = array['rows', 'total']
  and (select array_agg(k order by k) from jsonb_object_keys(current_setting('t.list')::jsonb -> 'rows' -> 0) k) = array['boughtOn', 'cancelledAt', 'id', 'lines', 'total']
  and (select array_agg(k order by k) from jsonb_object_keys(current_setting('t.list')::jsonb -> 'rows' -> 0 -> 'lines' -> 0) k)
    = array['expenseItemId', 'ingredientId', 'name', 'packLabel', 'packs', 'priceAfter', 'priceBefore', 'total']);

-- ================================================================ P2 an item of the other outlet
select set_config('t.n', pg_temp.purchases()::text, false);
select pg_temp.fails('P2a item of the other outlet', format('select public.owner_link_expense_items(%L, %L)', current_setting('t.o'),
  jsonb_build_array(jsonb_build_object('expenseItemId', pg_temp.item_id('Beli cabang'), 'ingredientId', pg_temp.ing(current_setting('t.o'), 'SKM'), 'packs', 1))),
  'Barang tidak ditemukan atau sudah dibatalkan');
reset role;
select pg_temp.ok('P2b nothing changed', pg_temp.purchases() = current_setting('t.n')::bigint and pg_temp.linked('Beli cabang') = 0);
select pg_temp.ok('P2c the lock is scoped to the outlet',
  pg_get_functiondef('public.owner_link_expense_items(uuid, jsonb)'::regprocedure) ~ 'e\.outlet_id = p_outlet_id\s+order by i\.id for update of i');

-- ================================================================ P3 signatures and grants
select pg_temp.ok('P3 grants unchanged',
  has_function_privilege('authenticated', 'public.owner_list_purchases(uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.owner_list_purchases(uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_link_expense_items(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.owner_link_expense_items(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.purchase_json(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.purchase_json(uuid)', 'execute'));
