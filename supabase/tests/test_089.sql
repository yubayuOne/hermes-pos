-- Tests for 089 (expense items linked to stock purchases). Every line of output must start with PASS.
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
create or replace function pg_temp.item(n text, cat text, amount int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('name', n, 'category', cat, 'quantity', 1, 'unit', 'pcs', 'amount', amount))
$$;
create or replace function pg_temp.rec(sh text, paid text, items jsonb, k text) returns jsonb language sql as $$
  select public.record_expense(sh::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, paid, items, k)
$$;
create or replace function pg_temp.cash() returns numeric language sql security definer as $$
  select (public.get_shift_cash_summary(current_setting('t.sh')::uuid) ->> 'expected_cash')::numeric
$$;
create or replace function pg_temp.ing(n text) returns text language sql security definer as $$
  select id::text from public.ingredients where outlet_id = current_setting('t.o')::uuid and name = n
$$;
create or replace function pg_temp.icol(n text, col text) returns text language plpgsql security definer as $$
declare v text;
begin execute format('select %I::text from public.ingredients where id = %L', col, pg_temp.ing(n)) into v; return v; end $$;
create or replace function pg_temp.item_id(n text) returns text language sql security definer as $$
  select i.id::text from public.expense_items i join public.expenses e on e.id = i.expense_id where e.outlet_id = current_setting('t.o')::uuid and i.name = n
$$;
create or replace function pg_temp.ln(item text, ing text, packs numeric) returns jsonb language sql as $$
  select jsonb_build_object('expenseItemId', pg_temp.item_id(item), 'ingredientId', pg_temp.ing(ing), 'packs', packs)
$$;
create or replace function pg_temp.link(lines jsonb) returns jsonb language sql as $$
  select public.owner_link_expense_items(current_setting('t.o')::uuid, lines)
$$;
create or replace function pg_temp.link_sql(lines jsonb) returns text language sql as $$
  select format('select public.owner_link_expense_items(%L, %L)', current_setting('t.o'), lines)
$$;
-- Purchase lines that point at the item, with whether their purchase is active.
create or replace function pg_temp.linked(item text, active boolean) returns bigint language sql security definer as $$
  select count(*) from public.purchase_lines l join public.purchases p on p.id = l.purchase_id
  where l.expense_item_id = pg_temp.item_id(item)::uuid and (p.cancelled_at is null) = active
$$;
create or replace function pg_temp.purchases() returns bigint language sql security definer as $$
  select count(*) from public.purchases where outlet_id = current_setting('t.o')::uuid
$$;

-- ================================================================ fixture
insert into auth.users(id, email) values ('e8900000-0000-0000-0000-000000000001', 'tautan@kopi.id'), ('e8900000-0000-0000-0000-000000000002', 'lain@tautan.id');
select set_config('request.jwt.claim.sub', 'e8900000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Tautan', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Tautan', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Tautan'), false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'SKM', 18000, 370, 'g', 'kaleng');
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'Susu', 18000, 1, 'l');
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'Gula', 30000, 1, 'kg');
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'Kopi', 120000, 1, 'kg');
select set_config('t.e', pg_temp.rec(current_setting('t.sh'), 'drawer', pg_temp.item('Beli SKM', 'belanja', 36000), 'k-1') ->> 'id', false);
select pg_temp.rec(current_setting('t.sh'), 'drawer', pg_temp.item('Plastik', 'operasional', 15000), 'k-2');
select pg_temp.rec(current_setting('t.sh'), 'other', pg_temp.item('Beli susu', 'belanja', 20000), 'k-3');
select pg_temp.rec(current_setting('t.sh'), 'drawer', pg_temp.item('Beli telur', 'belanja', 10000), 'k-4');
select pg_temp.ok('F1 fixture: cash 100.000 - 36.000 - 15.000 - 10.000', pg_temp.cash() = 39000 and current_setting('t.e') <> '');
reset role;

select pg_temp.ok('G1 grants',
  has_function_privilege('authenticated', 'public.owner_link_expense_items(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_stock_links_for_expense(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.owner_link_expense_items(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.owner_stock_links_for_expense(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.trg_expense_item_linked()', 'execute'));

-- ================================================================ link
set role authenticated;
select set_config('t.cash0', pg_temp.cash()::text, false);
select set_config('t.r1', pg_temp.link(jsonb_build_array(pg_temp.ln('Beli SKM', 'SKM', 2)))::text, false);
reset role;
select pg_temp.ok('L1 link: a new active purchase of 36.000 dated the shift day; 740 g at 18.000 a kaleng; the line points at the item',
  current_setting('t.r1')::jsonb ->> 'cancelledAt' is null
  and (current_setting('t.r1')::jsonb ->> 'total')::numeric = 36000
  and (current_setting('t.r1')::jsonb ->> 'boughtOn')::date = (select business_date from public.shifts where id = current_setting('t.sh')::uuid)
  and (current_setting('t.r1')::jsonb -> 'lines' -> 0 ->> 'total')::numeric = 36000
  and pg_temp.icol('SKM', 'stock')::numeric = 740 and pg_temp.icol('SKM', 'price')::numeric = 18000 and pg_temp.icol('SKM', 'stock_started') = 'true'
  and (select expense_item_id::text from public.purchase_lines where purchase_id = (current_setting('t.r1')::jsonb ->> 'id')::uuid) = pg_temp.item_id('Beli SKM'));
set role authenticated;
select pg_temp.ok('L2 cash unchanged by linking', pg_temp.cash() = current_setting('t.cash0')::numeric and pg_temp.cash() = 39000);

-- Review Focus 3: once only.
select set_config('t.n', pg_temp.purchases()::text, false);
select pg_temp.fails('L3a the same item again', pg_temp.link_sql(jsonb_build_array(pg_temp.ln('Beli SKM', 'SKM', 2))), 'sudah masuk stok');
select pg_temp.fails('L3b with another item in the same call', pg_temp.link_sql(jsonb_build_array(pg_temp.ln('Beli telur', 'Gula', 1), pg_temp.ln('Beli SKM', 'Kopi', 1))), 'sudah masuk stok');
select pg_temp.fails('L3c one item twice in one call', pg_temp.link_sql(jsonb_build_array(pg_temp.ln('Beli telur', 'Gula', 1), pg_temp.ln('Beli telur', 'Kopi', 1))), 'Satu barang hanya boleh sekali');
select pg_temp.fails('L3d one ingredient twice in one call', pg_temp.link_sql(jsonb_build_array(pg_temp.ln('Beli telur', 'Gula', 1), pg_temp.ln('Beli susu', 'Gula', 1))), 'Satu bahan hanya boleh sekali');
reset role;
select pg_temp.ok('L3 nothing was saved by the refused calls',
  pg_temp.purchases() = current_setting('t.n')::bigint and pg_temp.linked('Beli SKM', true) = 1 and pg_temp.linked('Beli telur', true) = 0
  and pg_temp.icol('Gula', 'stock_started') = 'false' and pg_temp.icol('SKM', 'stock')::numeric = 740);

set role authenticated;
select pg_temp.fails('L4 not belanja', pg_temp.link_sql(jsonb_build_array(pg_temp.ln('Plastik', 'Gula', 1))), 'Hanya barang belanja yang bisa masuk stok');
select pg_temp.fails('L11a packs 0', pg_temp.link_sql(jsonb_build_array(pg_temp.ln('Beli telur', 'Gula', 0))), 'Jumlah kemasan');
select pg_temp.fails('L11b empty', pg_temp.link_sql('[]'::jsonb), 'Isi minimal satu');
select pg_temp.fails('L11c not a uuid', pg_temp.link_sql(jsonb_build_array(jsonb_build_object('expenseItemId', 'x', 'ingredientId', pg_temp.ing('Gula'), 'packs', 1))), 'tidak valid');
select pg_temp.fails('L11d more than 50', pg_temp.link_sql((select jsonb_agg(pg_temp.ln('Beli telur', 'Gula', 1)) from generate_series(1, 51))), 'maksimal 50');
select pg_temp.fails('L11e unknown item', pg_temp.link_sql(jsonb_build_array(jsonb_build_object('expenseItemId', gen_random_uuid(), 'ingredientId', pg_temp.ing('Gula'), 'packs', 1))), 'Barang tidak ditemukan');

-- Review Focus 2: a linked item cannot be cancelled while its purchase is active.
select pg_temp.fails('L6 cancel blocked', format('select public.owner_cancel_expense_item(%L, %L)', pg_temp.item_id('Beli SKM'), 'Salah catat'), 'Barang ini sudah masuk stok. Batalkan belanjanya dulu.');
select pg_temp.ok('L6b the item and the cash stay', pg_temp.item_id('Beli SKM') is not null and pg_temp.cash() = 39000);

-- L9
select set_config('t.s1', public.owner_stock_links_for_expense(current_setting('t.e')::uuid)::text, false);
select pg_temp.ok('L9 stock links of the expense',
  current_setting('t.s1')::jsonb = jsonb_build_array(jsonb_build_object('expenseItemId', pg_temp.item_id('Beli SKM'),
    'purchaseId', current_setting('t.r1')::jsonb ->> 'id', 'ingredientId', pg_temp.ing('SKM'), 'ingredientName', 'SKM', 'packs', 2, 'active', true)));

-- L8: an item paid from elsewhere goes into stock too, cash alone.
select pg_temp.link(jsonb_build_array(pg_temp.ln('Beli susu', 'Susu', 1)));
reset role;
select pg_temp.ok('L8 other paid_from: stock 1000 ml at 20.000, cash still 39.000',
  pg_temp.icol('Susu', 'stock')::numeric = 1000 and pg_temp.icol('Susu', 'price')::numeric = 20000 and pg_temp.linked('Beli susu', true) = 1
  and pg_temp.cash() = 39000);

-- L7: cancelling the purchase releases the item.
set role authenticated;
select public.owner_cancel_purchase((current_setting('t.r1')::jsonb ->> 'id')::uuid, 'Salah bahan');
select set_config('t.r2', pg_temp.link(jsonb_build_array(pg_temp.ln('Beli SKM', 'SKM', 2)))::text, false);
reset role;
select pg_temp.ok('L7b after the purchase is cancelled the item links again',
  pg_temp.linked('Beli SKM', true) = 1 and pg_temp.linked('Beli SKM', false) = 1 and pg_temp.icol('SKM', 'stock')::numeric = 740
  and (current_setting('t.r2')::jsonb ->> 'id') <> (current_setting('t.r1')::jsonb ->> 'id'));
set role authenticated;
select pg_temp.ok('L9b stock links list the cancelled one as not active',
  (select count(*) from jsonb_array_elements(public.owner_stock_links_for_expense(current_setting('t.e')::uuid)) x
   where (x ->> 'active')::boolean = ((x ->> 'purchaseId') = current_setting('t.r2')::jsonb ->> 'id')) = 2);
select public.owner_cancel_purchase((current_setting('t.r2')::jsonb ->> 'id')::uuid, 'Salah bahan');
select set_config('t.x', pg_temp.item_id('Beli SKM'), false);
select public.owner_cancel_expense_item(current_setting('t.x')::uuid, 'Salah catat');
select pg_temp.ok('L7 with no active purchase the item can be cancelled; the cash takes the 36.000 back',
  pg_temp.item_id('Beli SKM') is null and pg_temp.cash() = 75000);
reset role;
select pg_temp.ok('L7c the old lines stay and no longer point at the item',
  (select count(*) from public.purchase_lines where purchase_id in ((current_setting('t.r1')::jsonb ->> 'id')::uuid, (current_setting('t.r2')::jsonb ->> 'id')::uuid)
   and expense_item_id is null) = 2);

-- L10: a purchase paid from takings, no link.
set role authenticated;
select set_config('t.r3', public.owner_save_purchase(current_setting('t.o')::uuid, (select business_date from public.shifts where id = current_setting('t.sh')::uuid),
  jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing('Kopi'), 'packs', 1, 'total', 110000)))::text, false);
reset role;
select pg_temp.ok('L10 owner-paid purchase unchanged',
  pg_temp.icol('Kopi', 'stock')::numeric = 1000 and pg_temp.icol('Kopi', 'price')::numeric = 110000
  and (select expense_item_id from public.purchase_lines where purchase_id = (current_setting('t.r3')::jsonb ->> 'id')::uuid) is null);

-- ================================================================ X1 another business
select set_config('request.jwt.claim.sub', 'e8900000-0000-0000-0000-000000000002', false);
set role authenticated;
select public.register_business('Toko Tautan Lain', 'Satu', null);
select set_config('t.n', pg_temp.purchases()::text, false);
select pg_temp.fails('X1a link', pg_temp.link_sql(jsonb_build_array(pg_temp.ln('Beli telur', 'Gula', 1))), 'Sesi kasir tidak valid');
select pg_temp.fails('X1b stock links', format('select public.owner_stock_links_for_expense(%L)', current_setting('t.e')), 'Sesi kasir tidak valid');
select pg_temp.fails('X1c stock links of an unknown expense', format('select public.owner_stock_links_for_expense(%L)', gen_random_uuid()), 'Sesi kasir tidak valid');
reset role;
select pg_temp.ok('X1 nothing changed', pg_temp.purchases() = current_setting('t.n')::bigint and pg_temp.linked('Beli telur', true) = 0);

select set_config('request.jwt.claim.sub', 'e8900000-0000-0000-0000-000000000001', false);

-- ================================================================ L5 one day
set role authenticated;
select public.close_shift(current_setting('t.sh')::uuid, 75000);
select set_config('t.sh2', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 50000)::text, false);
select pg_temp.rec(current_setting('t.sh2'), 'drawer', pg_temp.item('Beli kopi', 'belanja', 100000), 'k-5');
reset role;
update public.shifts set business_date = business_date - 1 where id = current_setting('t.sh2')::uuid;
set role authenticated;
select pg_temp.fails('L5 one day', pg_temp.link_sql(jsonb_build_array(pg_temp.ln('Beli telur', 'Gula', 1), pg_temp.ln('Beli kopi', 'Kopi', 1))), 'Pilih barang dari satu hari yang sama');
select set_config('t.r4', pg_temp.link(jsonb_build_array(pg_temp.ln('Beli kopi', 'Kopi', 1)))::text, false);
reset role;
select pg_temp.ok('L5b an item of the earlier day is bought on that day',
  (current_setting('t.r4')::jsonb ->> 'boughtOn')::date = (select business_date from public.shifts where id = current_setting('t.sh2')::uuid)
  and pg_temp.linked('Beli kopi', true) = 1 and pg_temp.linked('Beli telur', true) = 0);
