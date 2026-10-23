-- Tests for 088 (ingredient stock, purchases, the moving average price). Every line of output must start with PASS.
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
create or replace function pg_temp.ing(n text) returns text language sql security definer as $$
  select id::text from public.ingredients where outlet_id = current_setting('t.o')::uuid and name = n
$$;
-- One column of an ingredient, as text.
create or replace function pg_temp.icol(n text, col text) returns text language plpgsql security definer as $$
declare v text;
begin execute format('select %I::text from public.ingredients where id = %L', col, pg_temp.ing(n)) into v; return v; end $$;
create or replace function pg_temp.hpp() returns numeric language sql security definer as $$
  select hpp from public.products where id = current_setting('t.p')::uuid
$$;
create or replace function pg_temp.today() returns date language sql as $$
  select (now() at time zone public.outlet_tz(current_setting('t.o')::uuid))::date
$$;
create or replace function pg_temp.line(n text, packs numeric, total numeric) returns jsonb language sql as $$
  select jsonb_build_object('ingredientId', pg_temp.ing(n), 'packs', packs, 'total', total)
$$;
-- One purchase of one ingredient today.
create or replace function pg_temp.buy(n text, packs numeric, total numeric) returns jsonb language sql as $$
  select public.owner_save_purchase(current_setting('t.o')::uuid, pg_temp.today(), jsonb_build_array(pg_temp.line(n, packs, total)))
$$;
create or replace function pg_temp.purchases() returns bigint language sql security definer as $$
  select count(*) from public.purchases where outlet_id = current_setting('t.o')::uuid
$$;

-- ================================================================ fixture
insert into auth.users(id, email) values ('e8800000-0000-0000-0000-000000000001', 'belanja@kopi.id'), ('e8800000-0000-0000-0000-000000000002', 'lain@belanja.id');
select set_config('request.jwt.claim.sub', 'e8800000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Belanja', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select set_config('t.p', public.create_product(current_setting('t.o')::uuid, null, 'Es kopi susu', 0, 22000, 100)::text, false);
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'Kopi', 120000, 1, 'kg');
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'Susu', 18000, 1, 'l');
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'Gula aren', 30000, 1, 'kg');
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'Gelas', 1200, 1, 'pcs');
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'SKM', 18000, 370, 'g', 'kaleng');
select public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'Mikro', 100, 3, 'g');
select public.owner_save_recipe(current_setting('t.p')::uuid, jsonb_build_array(
  jsonb_build_object('ingredientId', pg_temp.ing('Kopi'), 'qty', 18, 'unit', 'g'),
  jsonb_build_object('ingredientId', pg_temp.ing('Susu'), 'qty', 150, 'unit', 'ml'),
  jsonb_build_object('ingredientId', pg_temp.ing('Gula aren'), 'qty', 15, 'unit', 'g'),
  jsonb_build_object('ingredientId', pg_temp.ing('Gelas'), 'qty', 1, 'unit', 'pcs')));
reset role;
select pg_temp.ok('F1 fixture: es kopi susu costs 6510, nothing started, SKM pack is a kaleng',
  pg_temp.hpp() = 6510 and pg_temp.icol('Susu', 'stock_started') = 'false' and pg_temp.icol('Susu', 'stock')::numeric = 0
  and pg_temp.icol('SKM', 'pack_label') = 'kaleng');

-- ================================================================ grants
select pg_temp.ok('G1 grants',
  has_function_privilege('authenticated', 'public.owner_save_purchase(uuid, date, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_cancel_purchase(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_list_purchases(uuid, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_list_ingredients(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.owner_save_purchase(uuid, date, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.owner_cancel_purchase(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.owner_list_purchases(uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.owner_list_ingredients(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text, text)', 'execute')
  and not exists (select 1 from pg_proc where proname = 'owner_save_ingredient' and pronargs = 6)
  and not has_table_privilege('authenticated', 'public.purchases', 'select')
  and not has_table_privilege('authenticated', 'public.purchase_lines', 'select')
  and not has_table_privilege('authenticated', 'public.ingredient_moves', 'select')
  and (select bool_and(relrowsecurity) from pg_class where oid in ('public.purchases'::regclass, 'public.purchase_lines'::regclass, 'public.ingredient_moves'::regclass)));

-- ================================================================ purchases
-- 12 packs of 1 l for 204.000 = 17.000 a liter. HPP: 6510 - 150 x (18 - 17) = 6360.
set role authenticated;
select set_config('t.r1', pg_temp.buy('Susu', 12, 204000)::text, false);
reset role;
select pg_temp.ok('P1 first purchase starts the stock',
  pg_temp.icol('Susu', 'stock')::numeric = 12000 and pg_temp.icol('Susu', 'stock_started') = 'true' and pg_temp.icol('Susu', 'price')::numeric = 17000
  and pg_temp.hpp() = 6360
  and (select count(*) from public.ingredient_moves where ingredient_id = pg_temp.ing('Susu')::uuid and kind = 'purchase' and qty = 12000
       and doc_id = (current_setting('t.r1')::jsonb ->> 'id')::uuid) = 1
  and (select count(*) from public.ingredient_moves where ingredient_id = pg_temp.ing('Susu')::uuid) = 1);
select pg_temp.ok('P1b the answer has the purchase and its line',
  (current_setting('t.r1')::jsonb ->> 'total')::numeric = 204000 and current_setting('t.r1')::jsonb ->> 'cancelledAt' is null
  and (current_setting('t.r1')::jsonb ->> 'boughtOn')::date = pg_temp.today()
  and current_setting('t.r1')::jsonb -> 'lines' = jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing('Susu'), 'name', 'Susu',
    'packLabel', null, 'packs', 12, 'total', 204000, 'priceBefore', 18000, 'priceAfter', 17000)));

-- The owner's example: 2 l on hand at 18.000, buy 1 l for 22.000 -> (36.000 + 22.000) / 3 l = 19.333,33 a liter.
-- HPP: 3810 + 150 x 19,33333 = 6710.
update public.ingredients set stock = 2000, price = 18000 where id = pg_temp.ing('Susu')::uuid;
set role authenticated;
select set_config('t.r2', pg_temp.buy('Susu', 1, 22000)::text, false);
reset role;
select pg_temp.ok('P2 moving average',
  pg_temp.icol('Susu', 'price')::numeric = 19333.33 and pg_temp.icol('Susu', 'stock')::numeric = 3000 and pg_temp.hpp() = 6710
  and (current_setting('t.r2')::jsonb -> 'lines' -> 0 ->> 'priceBefore')::numeric = 18000
  and (current_setting('t.r2')::jsonb -> 'lines' -> 0 ->> 'priceAfter')::numeric = 19333.33);

-- Review Focus 4: the latest purchase is cancelled, stock and price go back.
set role authenticated;
select pg_temp.fails('P6a a reason is required', format('select public.owner_cancel_purchase(%L, %L)', current_setting('t.r2')::jsonb ->> 'id', 'ab'), 'Alasan');
select set_config('t.c2', public.owner_cancel_purchase((current_setting('t.r2')::jsonb ->> 'id')::uuid, 'Salah catat')::text, false);
reset role;
select pg_temp.ok('P6 cancel the latest',
  pg_temp.icol('Susu', 'stock')::numeric = 2000 and pg_temp.icol('Susu', 'price')::numeric = 18000 and pg_temp.hpp() = 6510
  and current_setting('t.c2')::jsonb ->> 'cancelledAt' is not null
  and (select cancel_reason from public.purchases where id = (current_setting('t.r2')::jsonb ->> 'id')::uuid) = 'Salah catat'
  and (select count(*) from public.ingredient_moves where kind = 'purchase_cancel' and qty = -1000
       and doc_id = (current_setting('t.r2')::jsonb ->> 'id')::uuid) = 1);
set role authenticated;
select pg_temp.fails('P6b a cancelled purchase cannot be cancelled again', format('select public.owner_cancel_purchase(%L, %L)', current_setting('t.r2')::jsonb ->> 'id', 'lagi lagi'), 'sudah dibatalkan');
reset role;

update public.ingredients set stock = 0 where id = pg_temp.ing('Susu')::uuid;
set role authenticated;
select pg_temp.buy('Susu', 1, 22000);
reset role;
select pg_temp.ok('P3 stock <= 0 resets the average', pg_temp.icol('Susu', 'price')::numeric = 22000 and pg_temp.icol('Susu', 'stock')::numeric = 1000);

set role authenticated;
select pg_temp.buy('SKM', 2, 36000);
reset role;
select pg_temp.ok('P4 pack arithmetic', pg_temp.icol('SKM', 'stock')::numeric = 740 and pg_temp.icol('SKM', 'price')::numeric = 18000);

-- Review Focus 5: once running, the price follows the purchases and cannot be typed.
set role authenticated;
select pg_temp.fails('P5a price of a running ingredient', format('select public.owner_save_ingredient(%L, %L, %L, 25000, 1, %L)', current_setting('t.o'), pg_temp.ing('Susu'), 'Susu', 'l'), 'mengikuti catatan belanja');
select pg_temp.fails('P5b preview refuses it too', format('select public.owner_preview_ingredient(%L, 25000, 1, %L)', pg_temp.ing('Susu'), 'l'), 'mengikuti catatan belanja');
select public.owner_save_ingredient(current_setting('t.o')::uuid, pg_temp.ing('Gula aren')::uuid, 'Gula aren', 32000, 1, 'kg');
select public.owner_save_ingredient(current_setting('t.o')::uuid, pg_temp.ing('Susu')::uuid, 'Susu', 22000, 1, 'l', ' karton ');
reset role;
select pg_temp.ok('P5 price locked once running',
  pg_temp.icol('Gula aren', 'price')::numeric = 32000 and pg_temp.icol('Susu', 'price')::numeric = 22000 and pg_temp.icol('Susu', 'pack_label') = 'karton');
set role authenticated;
select pg_temp.fails('P5c pack name of 21 characters', format('select public.owner_save_ingredient(%L, %L, %L, 22000, 1, %L, %L)', current_setting('t.o'), pg_temp.ing('Susu'), 'Susu', 'l', repeat('x', 21)), 'Nama kemasan');
reset role;

set role authenticated;
select set_config('t.r7a', pg_temp.buy('Susu', 1, 20000)::text, false);
select set_config('t.r7b', public.owner_save_purchase(current_setting('t.o')::uuid, pg_temp.today(),
  jsonb_build_array(pg_temp.line('Susu', 1, 21000), pg_temp.line('Gelas', 10, 12000)))::text, false);
select pg_temp.fails('P7 cancel an older one is refused', format('select public.owner_cancel_purchase(%L, %L)', current_setting('t.r7a')::jsonb ->> 'id', 'Salah catat'), 'Sudah ada belanja setelahnya');
reset role;

-- ================================================================ validation
select set_config('t.n', pg_temp.purchases()::text, false);
set role authenticated;
select pg_temp.fails('P8a no lines', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today(), '[]'), 'minimal satu bahan');
select pg_temp.fails('P8b 51 lines', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today(),
  (select jsonb_agg(jsonb_build_object('ingredientId', gen_random_uuid(), 'packs', 1, 'total', 1)) from generate_series(1, 51))), 'maksimal 50');
select pg_temp.fails('P8c packs 0', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today(), jsonb_build_array(pg_temp.line('Kopi', 0, 1000))), 'Jumlah kemasan');
select pg_temp.fails('P8d packs 1.2345', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today(), jsonb_build_array(pg_temp.line('Kopi', 1.2345, 1000))), 'Jumlah kemasan');
select pg_temp.fails('P8e packs 1e6', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today(), jsonb_build_array(pg_temp.line('Kopi', 1000000, 1000))), 'Jumlah kemasan');
select pg_temp.fails('P8f negative total', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today(), jsonb_build_array(pg_temp.line('Kopi', 1, -1))), 'Total bayar');
select pg_temp.fails('P8f2 total over 1.000.000.000', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today(), jsonb_build_array(pg_temp.line('Kopi', 1, 1000000001))), 'Total bayar');
select pg_temp.fails('P8g the same ingredient twice', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today(),
  jsonb_build_array(pg_temp.line('Kopi', 1, 1000), pg_temp.line('Kopi', 2, 2000))), 'sekali');
select pg_temp.fails('P8h an ingredient of another outlet', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today(),
  jsonb_build_array(pg_temp.line('Kopi', 1, 1000), jsonb_build_object('ingredientId', gen_random_uuid(), 'packs', 1, 'total', 1))), 'tidak ditemukan');
select pg_temp.fails('P8i tomorrow', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today() + 1, jsonb_build_array(pg_temp.line('Kopi', 1, 1000))), 'masa depan');
select pg_temp.fails('P8j 91 days ago', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today() - 91, jsonb_build_array(pg_temp.line('Kopi', 1, 1000))), '90 hari');
select pg_temp.fails('P8k a 2-letter cancel reason', format('select public.owner_cancel_purchase(%L, %L)', current_setting('t.r7b')::jsonb ->> 'id', ' ab '), 'Alasan');
reset role;
select pg_temp.ok('P8 validation leaves nothing half saved',
  pg_temp.purchases() = current_setting('t.n')::bigint and pg_temp.icol('Kopi', 'stock_started') = 'false'
  and not exists (select 1 from public.ingredient_moves where ingredient_id = pg_temp.ing('Kopi')::uuid)
  and (select cancelled_at from public.purchases where id = (current_setting('t.r7b')::jsonb ->> 'id')::uuid) is null);
set role authenticated;
select public.owner_save_purchase(current_setting('t.o')::uuid, pg_temp.today() - 90, jsonb_build_array(pg_temp.line('Kopi', 1, 0)));
reset role;
select pg_temp.ok('P8l 90 days ago and a total of 0 are allowed', pg_temp.icol('Kopi', 'stock')::numeric = 1000 and pg_temp.icol('Kopi', 'price')::numeric = 0);

-- ================================================================ list
set role authenticated;
select set_config('t.l', public.owner_list_purchases(current_setting('t.o')::uuid)::text, false);
reset role;
select pg_temp.ok('P9 list',
  (current_setting('t.l')::jsonb ->> 'total')::int = pg_temp.purchases()
  and jsonb_array_length(current_setting('t.l')::jsonb -> 'rows') = pg_temp.purchases()
  and current_setting('t.l')::jsonb -> 'rows' -> 0 ->> 'id' = current_setting('t.r7b')::jsonb ->> 'id'
  and (current_setting('t.l')::jsonb -> 'rows' -> 0 ->> 'total')::numeric = 33000
  and jsonb_array_length(current_setting('t.l')::jsonb -> 'rows' -> 0 -> 'lines') = 2
  and (select r ->> 'cancelledAt' is not null from jsonb_array_elements(current_setting('t.l')::jsonb -> 'rows') r
       where r ->> 'id' = current_setting('t.r2')::jsonb ->> 'id'));
set role authenticated;
select pg_temp.ok('P9b page 2 is empty', jsonb_array_length(public.owner_list_purchases(current_setting('t.o')::uuid, 2) -> 'rows') = 0);
select pg_temp.ok('P9c the ingredient list shows stock, status, pack name, last count',
  exists (select 1 from jsonb_array_elements(public.owner_list_ingredients(current_setting('t.o')::uuid)) e
          where e ->> 'name' = 'SKM' and (e ->> 'stock')::numeric = 740 and (e ->> 'stockStarted')::boolean and e ->> 'packLabel' = 'kaleng'
            and e ? 'lastCountedAt' and e -> 'lastCountedAt' = 'null'::jsonb)
  and exists (select 1 from jsonb_array_elements(public.owner_list_ingredients(current_setting('t.o')::uuid)) e
              where e ->> 'name' = 'Gelas' and (e ->> 'stockStarted')::boolean and (e ->> 'stock')::numeric = 10));

-- ================================================================ rounding
-- Rp 100 a pack of 3 g: 3 packs for 300 = 9 g at 100 a pack; then 0.001 pack for free = 0.003 g more.
select pg_temp.buy('Mikro', 3, 300);
select pg_temp.buy('Mikro', 0.001, 0);
reset role;
select pg_temp.ok('P10 rounding',
  pg_temp.icol('Mikro', 'stock')::numeric = 9.003
  and pg_temp.icol('Mikro', 'price')::numeric = round(300 / 9.003 * 3, 2));

-- ================================================================ another business
select set_config('request.jwt.claim.sub', 'e8800000-0000-0000-0000-000000000002', false);
set role authenticated;
select public.register_business('Toko Lain Belanja', 'Satu', null);
select pg_temp.fails('X1a save', format('select public.owner_save_purchase(%L, %L, %L)', current_setting('t.o'), pg_temp.today(), jsonb_build_array(pg_temp.line('Kopi', 1, 1000))), 'Sesi kasir tidak valid');
select pg_temp.fails('X1b cancel', format('select public.owner_cancel_purchase(%L, %L)', current_setting('t.r7b')::jsonb ->> 'id', 'Bukan punya saya'), 'Sesi kasir tidak valid');
select pg_temp.fails('X1c list', format('select public.owner_list_purchases(%L)', current_setting('t.o')), 'Sesi kasir tidak valid');
reset role;
select pg_temp.ok('X1 another business', pg_temp.purchases() = current_setting('t.n')::bigint + 3
  and (select cancelled_at from public.purchases where id = (current_setting('t.r7b')::jsonb ->> 'id')::uuid) is null);

-- ================================================================ fix round 1: cancel after a pack change, cancel of the only purchase
select set_config('request.jwt.claim.sub', 'e8800000-0000-0000-0000-000000000001', false);
-- Gula aren is not running (32.000 a kg). Buy 1 kg for 40.000, repack to 500 g, cancel: the only purchase, so the stock
-- stops running at 0 and the price is the old 32 a g expressed per 500 g.
select set_config('t.h0', pg_temp.hpp()::text, false);
set role authenticated;
select set_config('t.rg', pg_temp.buy('Gula aren', 1, 40000)::text, false);
select public.owner_save_ingredient(current_setting('t.o')::uuid, pg_temp.ing('Gula aren')::uuid, 'Gula aren', 40000, 500, 'g');
reset role;
select pg_temp.ok('C1a repacking a running ingredient keeps its average per g', pg_temp.icol('Gula aren', 'price')::numeric = 20000);
set role authenticated;
select public.owner_cancel_purchase((current_setting('t.rg')::jsonb ->> 'id')::uuid, 'Salah catat');
reset role;
select pg_temp.ok('C1 cancelling the only purchase after a repack: not running, stock 0, average per g as before, HPP back',
  pg_temp.icol('Gula aren', 'stock_started') = 'false' and pg_temp.icol('Gula aren', 'stock')::numeric = 0
  and pg_temp.icol('Gula aren', 'price')::numeric = 16000
  and pg_temp.icol('Gula aren', 'price')::numeric / (pg_temp.icol('Gula aren', 'pack_qty')::numeric) = 32
  and pg_temp.hpp() = current_setting('t.h0')::numeric);
set role authenticated;
select public.owner_save_ingredient(current_setting('t.o')::uuid, pg_temp.ing('Gula aren')::uuid, 'Gula aren', 17000, 500, 'g');
reset role;
select pg_temp.ok('C1b the typed price is editable again', pg_temp.icol('Gula aren', 'price')::numeric = 17000);

-- Gelas runs at 10 pcs, 1.200 each, from an earlier live purchase. Buy 5 for 7.500 (average 1.300), repack to 10 pcs, cancel:
-- still running, 10 pcs, 1.200 a pcs again.
select set_config('t.h0', pg_temp.hpp()::text, false);
set role authenticated;
select set_config('t.rc', pg_temp.buy('Gelas', 5, 7500)::text, false);
select public.owner_save_ingredient(current_setting('t.o')::uuid, pg_temp.ing('Gelas')::uuid, 'Gelas', 1300, 10, 'pcs');
select public.owner_cancel_purchase((current_setting('t.rc')::jsonb ->> 'id')::uuid, 'Salah catat');
reset role;
select pg_temp.ok('C2 cancelling with another live purchase keeps the stock running, average per pcs as before, HPP back',
  pg_temp.icol('Gelas', 'stock_started') = 'true' and pg_temp.icol('Gelas', 'stock')::numeric = 10
  and pg_temp.icol('Gelas', 'price')::numeric = 12000 and pg_temp.icol('Gelas', 'pack_qty')::numeric = 10
  and pg_temp.hpp() = current_setting('t.h0')::numeric);

-- ================================================================ sales consume ingredients (Task 2)
-- Kopi runs at 1000 g, Gelas at 10 pcs, Gula aren is not running. Susu starts again at 12.000 ml from a purchase.
create or replace function pg_temp.st(n text) returns numeric language sql security definer as $$
  select stock from public.ingredients where id = pg_temp.ing(n)::uuid
$$;
-- Sale moves of a bill.
create or replace function pg_temp.sales(doc text) returns bigint language sql security definer as $$
  select count(*) from public.ingredient_moves where kind = 'sale' and doc_id = doc::uuid
$$;
create or replace function pg_temp.item(pid text, q int) returns jsonb language sql as $$
  select jsonb_build_object('product_id', current_setting(pid), 'quantity', q)
$$;
create or replace function pg_temp.pay(pid text, q int, k text, existing uuid default null) returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    jsonb_build_object('items', jsonb_build_array(pg_temp.item(pid, q))), 'cash', 1000000, null, k, null, existing) ->> 'transactionId')::uuid
$$;
-- The total stock of Kopi, Susu, Gelas, Gula aren, as one row to compare.
create or replace function pg_temp.snap() returns text language sql security definer as $$
  select string_agg(name || '=' || stock, ',' order by name) from public.ingredients
  where outlet_id = current_setting('t.o')::uuid and name in ('Kopi', 'Susu', 'Gelas', 'Gula aren')
$$;

update public.ingredients set stock = 0 where id = pg_temp.ing('Susu')::uuid;
set role authenticated;
select pg_temp.buy('Susu', 12, 216000);
select set_config('t.roti', public.create_product(current_setting('t.o')::uuid, null, 'Roti bakar', 6000, 18000, 50)::text, false);
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Rani', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Rani'), false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
select set_config('t.s1', pg_temp.pay('t.p', 2, 's-1')::text, false);
reset role;
-- 2 es kopi susu: susu 2 x 150 ml, kopi 2 x 18 g, gelas 2.
select pg_temp.ok('S1 a sale consumes',
  pg_temp.st('Susu') = 11700 and pg_temp.st('Kopi') = 964 and pg_temp.st('Gelas') = 8
  and pg_temp.icol('Susu', 'price')::numeric = 18000 and pg_temp.sales(current_setting('t.s1')) = 3
  and (select qty from public.ingredient_moves where kind = 'sale' and doc_id = current_setting('t.s1')::uuid and ingredient_id = pg_temp.ing('Susu')::uuid) = -300);
select pg_temp.ok('S2 not started is untouched', pg_temp.st('Gula aren') = 0 and pg_temp.icol('Gula aren', 'stock_started') = 'false'
  and not exists (select 1 from public.ingredient_moves where ingredient_id = pg_temp.ing('Gula aren')::uuid and kind = 'sale'));

select set_config('t.snap', pg_temp.snap(), false);
set role authenticated;
select set_config('t.s3', pg_temp.pay('t.roti', 1, 's-3')::text, false);
reset role;
select pg_temp.ok('S3 manual product', pg_temp.snap() = current_setting('t.snap') and pg_temp.sales(current_setting('t.s3')) = 0);

set role authenticated;
select set_config('t.h', public.save_held_bill(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
  jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.p', 1))), 'h-1')::text, false);
reset role;
select pg_temp.ok('S4a a held bill does not consume', pg_temp.snap() = current_setting('t.snap') and pg_temp.sales(current_setting('t.h')) = 0);
set role authenticated;
select pg_temp.pay('t.p', 1, 's-4', current_setting('t.h')::uuid);
reset role;
select pg_temp.ok('S4 held bill: consumed once, when paid', pg_temp.st('Susu') = 11550 and pg_temp.st('Gelas') = 7 and pg_temp.sales(current_setting('t.h')) = 3);

-- Review Focus 2.
select set_config('t.snap', pg_temp.snap(), false);
set role authenticated;
select public.void_transaction_approved(current_setting('t.s1')::uuid, 'Salah input', '271828');
reset role;
select pg_temp.ok('S5 void does not return', pg_temp.snap() = current_setting('t.snap'));
set role authenticated;
select set_config('t.s6', pg_temp.pay('t.p', 1, 's-6')::text, false);
select set_config('t.snap', pg_temp.snap(), false);
select public.refund_items_approved(current_setting('t.s6')::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting('t.s6')::uuid), 'quantity', 1, 'restock', true)),
  'cash', 'Tumpah', '271828', 'r-1');
reset role;
select pg_temp.ok('S6 refund does not return', pg_temp.snap() = current_setting('t.snap'));

-- Review Focus 1: 2 corrected to 3 consumes 1 more; corrected down to 1 changes nothing.
set role authenticated;
select set_config('t.s7', pg_temp.pay('t.p', 2, 's-7')::text, false);
select set_config('t.snap', pg_temp.snap(), false);
select set_config('t.k1', public.owner_correct_bill(current_setting('t.s7')::uuid,
  jsonb_build_array(jsonb_build_object('itemId', (select id from public.transaction_items where transaction_id = current_setting('t.s7')::uuid), 'quantity', 3)),
  'cash', '', '', 'Tambah satu') ->> 'id', false);
reset role;
select pg_temp.ok('S7a correction 2 to 3 consumes only the extra one',
  pg_temp.st('Susu') = split_part(split_part(current_setting('t.snap'), 'Susu=', 2), ',', 1)::numeric - 150
  and pg_temp.st('Gelas') = split_part(split_part(current_setting('t.snap'), 'Gelas=', 2), ',', 1)::numeric - 1
  and pg_temp.sales(current_setting('t.k1')) = 3
  and (select qty from public.ingredient_moves where kind = 'sale' and doc_id = current_setting('t.k1')::uuid and ingredient_id = pg_temp.ing('Susu')::uuid) = -150);
select set_config('t.snap', pg_temp.snap(), false);
set role authenticated;
select set_config('t.k2', public.owner_correct_bill(current_setting('t.k1')::uuid,
  jsonb_build_array(jsonb_build_object('itemId', (select id from public.transaction_items where transaction_id = current_setting('t.k1')::uuid), 'quantity', 1)),
  'cash', '', '', 'Jadi satu') ->> 'id', false);
reset role;
select pg_temp.ok('S7 correction adds only the extra; 3 to 1 neither returns nor consumes',
  pg_temp.snap() = current_setting('t.snap') and pg_temp.sales(current_setting('t.k2')) = 0);

-- Two completions of the same bill in one transaction.
set role authenticated;
select set_config('t.h8', public.save_held_bill(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
  jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.p', 1))), 'h-8')::text, false);
reset role;
select set_config('t.snap', pg_temp.snap(), false);
begin;
update public.transactions set status = 'completed' where id = current_setting('t.h8')::uuid;
update public.transactions set status = 'held' where id = current_setting('t.h8')::uuid;
update public.transactions set status = 'completed' where id = current_setting('t.h8')::uuid;
commit;
select pg_temp.ok('S8 deferred trigger is idempotent', pg_temp.sales(current_setting('t.h8')) = 3
  and pg_temp.st('Susu') = split_part(split_part(current_setting('t.snap'), 'Susu=', 2), ',', 1)::numeric - 150);

select set_config('t.snap', pg_temp.snap(), false);
set role authenticated;
select public.owner_save_recipe(current_setting('t.p')::uuid, jsonb_build_array(
  jsonb_build_object('ingredientId', pg_temp.ing('Kopi'), 'qty', 20, 'unit', 'g'),
  jsonb_build_object('ingredientId', pg_temp.ing('Susu'), 'qty', 200, 'unit', 'ml'),
  jsonb_build_object('ingredientId', pg_temp.ing('Gelas'), 'qty', 1, 'unit', 'pcs')));
reset role;
select pg_temp.ok('S9 recipe edited later', pg_temp.snap() = current_setting('t.snap'));

-- A sale must never fail because of ingredients.
select set_config('t.snap', pg_temp.snap(), false);
alter table public.ingredients add constraint tmp_block check (stock >= 1e12) not valid;
set role authenticated;
select set_config('t.s10', pg_temp.pay('t.p', 1, 's-10')::text, false);
reset role;
alter table public.ingredients drop constraint tmp_block;
set role authenticated;
select set_config('t.s10b', pg_temp.pay('t.p', 1, 's-10b')::text, false);
reset role;
select pg_temp.ok('S10 a failing consumption never blocks the sale',
  (select status::text from public.transactions where id = current_setting('t.s10')::uuid) = 'completed'
  and pg_temp.sales(current_setting('t.s10')) = 0
  and pg_temp.sales(current_setting('t.s10b')) = 3
  and pg_temp.st('Susu') = split_part(split_part(current_setting('t.snap'), 'Susu=', 2), ',', 1)::numeric - 200);
