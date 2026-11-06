-- Tests for 099 (barang: stock from expenses, the average price, cancel, count, sales, categories). Every line of output must start with PASS.
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
-- Reads and writes the tables the owner cannot reach directly (run as the function owner).
create or replace function pg_temp.q(sql text) returns text language plpgsql security definer as $$
declare r text; begin execute sql into r; return r; end $$;
create or replace function pg_temp.qb(sql text) returns boolean language plpgsql security definer as $$
declare r boolean; begin execute sql into r; return coalesce(r, false); end $$;
create or replace function pg_temp.run(sql text) returns void language plpgsql security definer as $$
begin execute sql; end $$;

insert into auth.users(id, email) values ('99000000-0000-0000-0000-000000000001', 'pemilik@barang.id'), ('99000000-0000-0000-0000-000000000002', 'lain@barang.id');

-- Warung: one business, one outlet, one cashier, one open shift.
select set_config('request.jwt.claim.sub', '99000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Warung Barang', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Sari', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Sari'), false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
select pg_temp.ok('B0 a new business has no expense categories (100)', public.owner_list_expense_categories()::text = '[]');
select public.owner_save_expense_category(null, 'Belanja', true);

-- Barang: minyak (counted, ml) and listrik (not counted).
select set_config('t.minyak', public.owner_save_barang(current_setting('t.o')::uuid, null, 'Minyak goreng', 'ml', true)::text, false);
select set_config('t.listrik', public.owner_save_barang(current_setting('t.o')::uuid, null, 'Listrik', 'pcs', false)::text, false);
select pg_temp.ok('B1 a new barang is counted or not as asked, starts with no stock and no price',
  pg_temp.qb(format('select dihitung_stok and not stock_started and stock = 0 and price = 0 and pack_unit = ''ml'' from public.ingredients where id = %L', current_setting('t.minyak'))));

-- B2: the first bottle of 1 L costs 20.000 and weighs 1.000 ml. The stock starts at that weight, the price per ml is 20.
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
  'name', 'Minyak botol 1', 'category', 'belanja', 'quantity', 1, 'unit', 'botol', 'amount', 20000,
  'ingredientId', current_setting('t.minyak'), 'stockQty', 1000)));
select pg_temp.ok('B2 an expense with a stock amount starts the stock: 1.000 ml at Rp 20 each',
  pg_temp.qb(format('select stock = 1000 and price = 20 and stock_started from public.ingredients where id = %L', current_setting('t.minyak'))));

-- B3: the second bottle is weighed at 1.050 ml (more than the label). The average is (1.000 x 20 + 22.000) / 2.050.
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
  'name', 'Minyak botol 2', 'category', 'belanja', 'quantity', 1, 'unit', 'botol', 'amount', 22000,
  'ingredientId', current_setting('t.minyak'), 'stockQty', 1050)));
select pg_temp.ok('B3 the average follows the weighed amount, not the label: 2.050 ml at Rp 20,487805',
  pg_temp.qb(format('select stock = 2050 and price = 20.487805 from public.ingredients where id = %L', current_setting('t.minyak'))));
select set_config('t.botol2', pg_temp.q(format('select id::text from public.expense_items where name = %L', 'Minyak botol 2')), false);

-- B4: an expense without a stock amount keeps the stock as it is; the owner fills the amount later.
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
  'name', 'Minyak tanpa jumlah', 'category', 'belanja', 'quantity', 1, 'unit', 'botol', 'amount', 9000,
  'ingredientId', current_setting('t.minyak'))));
select set_config('t.tanpa', pg_temp.q(format('select id::text from public.expense_items where name = %L', 'Minyak tanpa jumlah')), false);
select pg_temp.ok('B4 an item with no stock amount is waiting: the stock does not move',
  pg_temp.qb(format('select stock = 2050 and stock_qty is null from public.ingredients i, public.expense_items e where i.id = %L and e.id = %L', current_setting('t.minyak'), current_setting('t.tanpa'))));
select public.owner_set_expense_stock(current_setting('t.tanpa')::uuid, 500);
select pg_temp.ok('B4b the owner sets 500 ml: the stock and the average follow',
  pg_temp.qb(format('select stock = 2550 and abs(price - (2050 * 20.487805 + 9000) / 2550) < 0.00001 from public.ingredients where id = %L', current_setting('t.minyak'))));
select public.owner_set_expense_stock(current_setting('t.tanpa')::uuid, null);
select pg_temp.ok('B5 clearing the amount takes the stock and the average back exactly',
  pg_temp.qb(format('select stock = 2050 and price = 20.487805 from public.ingredients where id = %L', current_setting('t.minyak'))));

-- B6: an older item cannot be cancelled while a later move of the barang stands.
select pg_temp.fails('B6 an older item is refused while a later move stands',
  format('select public.owner_cancel_expense_item(%L, %L)', current_setting('t.botol2'), 'salah input'), 'Sudah ada pergerakan stok setelahnya');

-- B7: the latest item is cancelled: stock and average go back to what they were before it.
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
  'name', 'Minyak botol 3', 'category', 'belanja', 'quantity', 1, 'unit', 'botol', 'amount', 6000,
  'ingredientId', current_setting('t.minyak'), 'stockQty', 300)));
select set_config('t.botol3', pg_temp.q(format('select id::text from public.expense_items where name = %L', 'Minyak botol 3')), false);
select public.owner_cancel_expense_item(current_setting('t.botol3')::uuid, 'salah input');
select pg_temp.ok('B7 cancelling the latest item puts the stock and the average back',
  pg_temp.qb(format('select stock = 2050 and price = 20.487805 from public.ingredients where id = %L', current_setting('t.minyak'))));

-- B8: a barang that is not counted (listrik) takes no stock.
select pg_temp.fails('B8 a stock amount on a barang that is not counted is refused',
  $q$select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
    'name', 'Listrik Maret', 'category', 'Belanja', 'quantity', 1, 'unit', 'botol', 'amount', 150000,
    'ingredientId', current_setting('t.listrik'), 'stockQty', 5)))$q$, 'tidak dihitung stoknya');
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
  'name', 'Listrik Maret', 'category', 'Belanja', 'quantity', 1, 'unit', 'botol', 'amount', 150000,
  'ingredientId', current_setting('t.listrik'))));
select pg_temp.ok('B8b the same barang without a stock amount is a plain expense: no moves, no stock',
  pg_temp.qb(format('select not exists (select 1 from public.ingredient_moves where ingredient_id = %L) and not stock_started from public.ingredients where id = %L',
    current_setting('t.listrik'), current_setting('t.listrik'))));

-- B9: a barang with stock can no longer change its unit or whether it is counted.
select pg_temp.fails('B9 unit change after stock is refused',
  $q$select public.owner_save_barang(current_setting('t.o')::uuid, current_setting('t.minyak')::uuid, 'Minyak goreng', 'g', true)$q$,
  'tidak bisa diubah setelah barang punya catatan stok');
select pg_temp.fails('B9b counted flag change after stock is refused',
  $q$select public.owner_save_barang(current_setting('t.o')::uuid, current_setting('t.minyak')::uuid, 'Minyak goreng', 'ml', false)$q$,
  'tidak bisa diubah setelah barang punya catatan stok');
select public.owner_save_barang(current_setting('t.o')::uuid, current_setting('t.minyak')::uuid, 'Minyak goreng botol', 'ml', true);
select pg_temp.ok('B9c the name can still change', pg_temp.qb(format('select name = %L from public.ingredients where id = %L', 'Minyak goreng botol', current_setting('t.minyak'))));

-- B10: a counted count. The count is 1.900 ml; the difference (-150) is valued at the average.
select pg_temp.ok('B10 a count books the difference at the average',
  (select (x ->> 'kind') = 'count' and (x ->> 'diff')::numeric = -150
   from jsonb_array_elements(public.owner_count_ingredients(current_setting('t.o')::uuid,
     jsonb_build_array(jsonb_build_object('ingredientId', current_setting('t.minyak'), 'qty', 1900, 'unit', 'ml')))  -> 'lines') x)
  and pg_temp.qb(format('select stock = 1900 from public.ingredients where id = %L', current_setting('t.minyak'))));
select pg_temp.fails('B10b a count of a barang that is not counted is refused',
  format('select public.owner_count_ingredients(%L, jsonb_build_array(jsonb_build_object(''ingredientId'', %L, ''qty'', 1, ''unit'', %L)))',
    current_setting('t.o'), current_setting('t.listrik'), 'pcs'), 'tidak dihitung stoknya');

-- B11: a recipe uses counted barang only; a recipe of counted barang takes stock on sale.
select set_config('t.prod', public.create_product(current_setting('t.o')::uuid, null, 'Es susu', 4000, 10000, 100)::text, false);
select pg_temp.fails('B11 a recipe with a barang that is not counted is refused',
  $q$select public.owner_save_product(current_setting('t.prod')::uuid, current_setting('t.o')::uuid, null, 'Es susu', 0, 10000, 100, 'kitchen', true,
    jsonb_build_array(jsonb_build_object('ingredientId', current_setting('t.listrik'), 'qty', 1, 'unit', 'pcs')))$q$,
  'tidak bisa dipakai di resep');
select public.owner_save_product(current_setting('t.prod')::uuid, current_setting('t.o')::uuid, null, 'Es susu', 0, 10000, 100, 'kitchen', true,
  jsonb_build_array(jsonb_build_object('ingredientId', current_setting('t.minyak'), 'qty', 2, 'unit', 'ml')));
select pg_temp.run(format('select public.consume_ingredients(gen_random_uuid(), %L::jsonb)',
  jsonb_build_array(jsonb_build_object('productId', current_setting('t.prod'), 'qty', 3))::text));
select pg_temp.ok('B11b three cups use six ml; the stock goes down by that',
  pg_temp.qb(format('select stock = 1894 and exists (select 1 from public.ingredient_moves where ingredient_id = %L and kind = ''sale'' and qty = -6) from public.ingredients where id = %L',
    current_setting('t.minyak'), current_setting('t.minyak'))));

-- B12: categories. The owner's list; unknown and switched-off categories are refused.
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
  'name', 'Biaya tanpa kategori', 'quantity', 1, 'unit', 'botol', 'amount', 5000)));
select pg_temp.ok('B12a an item may have no category', pg_temp.qb(format('select exists (select 1 from public.expense_items where name = %L and category is null)', 'Biaya tanpa kategori')));
select set_config('t.cat', public.owner_save_expense_category(null, 'Listrik', true)::text, false);
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
  'name', 'Iuran sampah', 'category', 'LISTRIK', 'quantity', 1, 'unit', 'botol', 'amount', 30000)));
select pg_temp.fails('B12b a category that is not in the list is refused',
  $q$select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
    'name', 'Hiburan', 'category', 'hiburan', 'quantity', 1, 'unit', 'botol', 'amount', 10000)))$q$, 'Kategori tidak tersedia');
select public.owner_save_expense_category(current_setting('t.cat')::uuid, 'Listrik', false);
select pg_temp.fails('B12c a switched-off category is refused',
  $q$select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
    'name', 'Iuran lagi', 'category', 'Listrik', 'quantity', 1, 'unit', 'botol', 'amount', 10000)))$q$, 'Kategori tidak tersedia');
select pg_temp.fails('B12d a category name in another case is taken',
  $q$select public.owner_save_expense_category(null, 'belanja', true)$q$, 'sudah dipakai');

-- B13: the stock is the owner's only: another business sees nothing of this outlet.
select set_config('request.jwt.claim.sub', '99000000-0000-0000-0000-000000000002', false);
select public.register_business('Warung Lain', 'Satu', null);
select pg_temp.fails('B13 another owner cannot set the stock of this outlet',
  format('select public.owner_set_expense_stock(%L, 100)', current_setting('t.tanpa')), 'Barang tidak ditemukan');
select pg_temp.fails('B13b another owner cannot change this barang',
  format('select public.owner_save_barang(%L, %L, %L, %L, true)', current_setting('t.o'), current_setting('t.minyak'), 'Lain', 'ml'), 'Sesi kasir tidak valid');
select set_config('request.jwt.claim.sub', '99000000-0000-0000-0000-000000000001', false);

-- B14: grants. Belanja and the purchase links are closed; the owner's functions are open.
select pg_temp.ok('B14 grants: purchases and the old barang save are closed, the new ones are open',
  not has_function_privilege('authenticated', 'public.owner_save_purchase(uuid, date, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.owner_cancel_purchase(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.owner_link_expense_items(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_save_barang(uuid, uuid, text, text, boolean, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_set_expense_stock(uuid, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.owner_save_barang(uuid, uuid, text, text, boolean, text)', 'execute'));

-- B15 (101): the category and the unit come from the barang; the typed ones are ignored.
select set_config('t.gula', public.owner_save_barang(current_setting('t.o')::uuid, null, 'Gula pasir', 'g', true, 'Belanja')::text, false);
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
  'name', '', 'category', 'Listrik', 'quantity', 2, 'unit', 'botol', 'amount', 30000, 'ingredientId', current_setting('t.gula'))));
select pg_temp.ok('B15 a barang gives its category and unit to the expense',
  pg_temp.qb(format('select category = %L and unit = %L and name = %L from public.expense_items where ingredient_id = %L', 'Belanja', 'g', 'Gula pasir', current_setting('t.gula'))));
select pg_temp.fails('B15b a category that is not on the list is refused for the barang',
  $q$select public.owner_save_barang(current_setting('t.o')::uuid, null, 'Garam', 'g', true, 'Hiburan')$q$, 'Kategori tidak tersedia');
reset role;
