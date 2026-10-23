-- Tests for 084 (ingredients, recipes, HPP from a recipe). Every line of output must start with PASS.
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
-- The es kopi susu recipe: 18 g coffee, 150 ml milk, 15 g palm sugar, 1 cup.
create or replace function pg_temp.kopi_lines() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('ingredientId', pg_temp.ing('Kopi arabika'), 'qty', 18, 'unit', 'g'),
    jsonb_build_object('ingredientId', pg_temp.ing('Susu cair'), 'qty', 150, 'unit', 'ml'),
    jsonb_build_object('ingredientId', pg_temp.ing('Gula aren'), 'qty', 15, 'unit', 'g'),
    jsonb_build_object('ingredientId', pg_temp.ing('Gelas'), 'qty', 1, 'unit', 'pcs'))
$$;
create or replace function pg_temp.hpp() returns numeric language sql security definer as $$
  select hpp from public.products where id = current_setting('t.p')::uuid
$$;

insert into auth.users(id, email) values ('e8400000-0000-0000-0000-000000000001', 'resep@kopi.id'), ('e8400000-0000-0000-0000-000000000002', 'lain@resep.id');
select set_config('request.jwt.claim.sub', 'e8400000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Resep', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select set_config('t.p', public.create_product(current_setting('t.o')::uuid, null, 'Es kopi susu', 0, 22000, 100)::text, false);
select set_config('t.p2', public.create_product(current_setting('t.o')::uuid, null, 'Roti bakar', 5000, 15000, 100)::text, false);
reset role;

insert into public.ingredients(outlet_id, name, price, pack_qty, pack_unit) values
  (current_setting('t.o')::uuid, 'Kopi arabika', 120000, 1, 'kg'),
  (current_setting('t.o')::uuid, 'Susu cair', 18000, 1, 'l'),
  (current_setting('t.o')::uuid, 'Gula aren', 30000, 1, 'kg'),
  (current_setting('t.o')::uuid, 'Gelas', 1200, 1, 'pcs'),
  (current_setting('t.o')::uuid, 'Mikro', 100, 3, 'g'),
  (current_setting('t.o')::uuid, 'Gratis', 0, 1, 'kg');

select pg_temp.ok('U1a factors', public.unit_factor('kg') = 1000 and public.unit_factor('l') = 1000 and public.unit_factor('g') = 1 and public.unit_factor('ml') = 1 and public.unit_factor('pcs') = 1);
select pg_temp.ok('U1b families', public.unit_family('ml') = 'volume' and public.unit_family('kg') = 'mass' and public.unit_family('pcs') = 'count');
select pg_temp.fails('U1c unknown unit', $q$select public.unit_family('sdm')$q$, 'Satuan');

select pg_temp.ok('C1 es kopi susu costs 6510',
  (public.recipe_cost(current_setting('t.o')::uuid, pg_temp.kopi_lines()) ->> 'hpp')::numeric = 6510
  and (public.recipe_cost(current_setting('t.o')::uuid, pg_temp.kopi_lines()) ->> 'incomplete')::boolean = false);
select pg_temp.ok('C2 sub-rupiah unit price is kept: Rp 100 per 3 g, 1 g = 33.33',
  (public.recipe_cost(current_setting('t.o')::uuid, jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing('Mikro'), 'qty', 1, 'unit', 'g'))) ->> 'hpp')::numeric = 33.33);
select pg_temp.ok('C3 a Rp 0 ingredient is flagged on the line and the total',
  (public.recipe_cost(current_setting('t.o')::uuid, jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing('Gratis'), 'qty', 5, 'unit', 'g'))) ->> 'incomplete')::boolean
  and (public.recipe_cost(current_setting('t.o')::uuid, jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing('Gratis'), 'qty', 5, 'unit', 'g'))) -> 'lines' -> 0 ->> 'incomplete')::boolean);
select pg_temp.fails('C4 a unit of another family is refused',
  format('select public.recipe_cost(%L, %L::jsonb)', current_setting('t.o'),
    jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing('Kopi arabika'), 'qty', 5, 'unit', 'ml'))::text), 'satuan');
select pg_temp.fails('C4b an ingredient of another outlet is refused',
  format('select public.recipe_cost(%L, %L::jsonb)', gen_random_uuid(), pg_temp.kopi_lines()::text), 'tidak ditemukan');

insert into public.recipe_lines(product_id, ingredient_id, qty, unit)
select current_setting('t.p')::uuid, (e ->> 'ingredientId')::uuid, (e ->> 'qty')::numeric, e ->> 'unit' from jsonb_array_elements(pg_temp.kopi_lines()) e;
select public.recompute_hpp(current_setting('t.p')::uuid);
select pg_temp.ok('C5a a manual product is not recomputed', pg_temp.hpp() = 0);
update public.products set hpp_source = 'recipe' where id = current_setting('t.p')::uuid;
select public.recompute_hpp(current_setting('t.p')::uuid);
select pg_temp.ok('C5b a recipe product takes the recipe cost', pg_temp.hpp() = 6510);
select public.recompute_hpp(current_setting('t.p2')::uuid);
select pg_temp.ok('C5c a manual product keeps its typed HPP', (select hpp from public.products where id = current_setting('t.p2')::uuid) = 5000);

select pg_temp.ok('G1 clients have no direct access to the new tables',
  not has_table_privilege('authenticated', 'public.ingredients', 'select')
  and not has_table_privilege('authenticated', 'public.recipe_lines', 'select')
  and not has_table_privilege('anon', 'public.ingredients', 'select'));

-- ================================================================ ingredient RPCs
select pg_temp.ok('I1 owners may call the ingredient functions, anon may not',
  has_function_privilege('authenticated', 'public.owner_list_ingredients(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_preview_ingredient(uuid, numeric, numeric, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_delete_ingredient(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.owner_list_ingredients(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text)', 'execute'));

select set_config('request.jwt.claim.sub', 'e8400000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.vanila', public.owner_save_ingredient(current_setting('t.o')::uuid, null, '  Sirup vanila ', 45000, 750, 'ml')::text, false);
select pg_temp.ok('I2 created, trimmed, listed with its price per base unit',
  exists (
    select 1 from jsonb_array_elements(public.owner_list_ingredients(current_setting('t.o')::uuid)) e
    where e ->> 'name' = 'Sirup vanila' and (e ->> 'unitCost')::numeric = 60 and e ->> 'baseUnit' = 'ml'
      and (e ->> 'packQty')::numeric = 750 and e ->> 'packUnit' = 'ml' and (e ->> 'usedBy')::int = 0));
select pg_temp.ok('I2b Susu cair is used by one product',
  (select (e ->> 'usedBy')::int from jsonb_array_elements(public.owner_list_ingredients(current_setting('t.o')::uuid)) e where e ->> 'name' = 'Susu cair') = 1);
select pg_temp.fails('I3a duplicate name, any case', format('select public.owner_save_ingredient(%L, null, %L, 1, 1, %L)', current_setting('t.o'), ' SIRUP VANILA', 'ml'), 'sudah dipakai');
select pg_temp.fails('I3b empty name', format('select public.owner_save_ingredient(%L, null, %L, 1, 1, %L)', current_setting('t.o'), '   ', 'ml'), 'wajib diisi');
select pg_temp.fails('I3c negative price', format('select public.owner_save_ingredient(%L, null, %L, -1, 1, %L)', current_setting('t.o'), 'X1', 'ml'), 'Harga');
select pg_temp.fails('I3d pack size 0', format('select public.owner_save_ingredient(%L, null, %L, 1, 0, %L)', current_setting('t.o'), 'X2', 'ml'), 'Isi kemasan');
select pg_temp.fails('I3e unknown unit', format('select public.owner_save_ingredient(%L, null, %L, 1, 1, %L)', current_setting('t.o'), 'X3', 'sdm'), 'Satuan tidak valid');

-- Preview does not write, and lists the affected recipe products with the old and new HPP.
select pg_temp.ok('I5 preview of Susu at Rp 20.000 shows 6510 -> 6810',
  public.owner_preview_ingredient(pg_temp.ing('Susu cair')::uuid, 20000, 1, 'l')
    = jsonb_build_array(jsonb_build_object('productId', current_setting('t.p'), 'name', 'Es kopi susu', 'oldHpp', 6510, 'newHpp', 6810)));
reset role;
select pg_temp.ok('I5b preview did not change the product', pg_temp.hpp() = 6510);
set role authenticated;

select public.owner_save_ingredient(current_setting('t.o')::uuid, pg_temp.ing('Susu cair')::uuid, 'Susu cair', 20000, 1, 'l');
reset role;
select pg_temp.ok('I4 repricing an ingredient recalculates its recipe products', pg_temp.hpp() = 6810);
select pg_temp.ok('I4b a manual product is not touched', (select hpp from public.products where id = current_setting('t.p2')::uuid) = 5000);
set role authenticated;

-- Review focus 1: a used ingredient cannot change family.
select pg_temp.fails('I6a used ingredient: l -> kg refused', format('select public.owner_save_ingredient(%L, %L, %L, 20000, 1, %L)', current_setting('t.o'), pg_temp.ing('Susu cair'), 'Susu cair', 'kg'), 'tidak bisa berganti jenis');
select pg_temp.fails('I6b preview refuses it too', format('select public.owner_preview_ingredient(%L, 20000, 1, %L)', pg_temp.ing('Susu cair'), 'kg'), 'tidak bisa berganti jenis');
select public.owner_save_ingredient(current_setting('t.o')::uuid, current_setting('t.vanila')::uuid, 'Sirup vanila', 45000, 1, 'kg');
reset role;
select pg_temp.ok('I6c an unused ingredient may change family', (select pack_unit from public.ingredients where id = current_setting('t.vanila')::uuid) = 'kg');
set role authenticated;

select pg_temp.fails('I7a delete of a used ingredient names the product', format('select public.owner_delete_ingredient(%L)', pg_temp.ing('Susu cair')), 'Dipakai di resep: Es kopi susu');
select public.owner_delete_ingredient(current_setting('t.vanila')::uuid);
reset role;
select pg_temp.ok('I7b an unused ingredient is deleted', not exists (select 1 from public.ingredients where id = current_setting('t.vanila')::uuid));

-- Another business sees and changes nothing.
select set_config('request.jwt.claim.sub', 'e8400000-0000-0000-0000-000000000002', false);
set role authenticated;
select public.register_business('Toko Lain', 'Satu', null);
select pg_temp.fails('X1a list', format('select public.owner_list_ingredients(%L)', current_setting('t.o')), 'Sesi kasir tidak valid');
select pg_temp.fails('X1b save', format('select public.owner_save_ingredient(%L, %L, %L, 1, 1, %L)', current_setting('t.o'), pg_temp.ing('Gelas'), 'Gelas', 'pcs'), 'Sesi kasir tidak valid');
select pg_temp.fails('X1c delete', format('select public.owner_delete_ingredient(%L)', pg_temp.ing('Gelas')), 'Sesi kasir tidak valid');
select pg_temp.fails('X1d preview', format('select public.owner_preview_ingredient(%L, 1, 1, %L)', pg_temp.ing('Gelas'), 'pcs'), 'Sesi kasir tidak valid');
reset role;
select pg_temp.ok('X2 the ingredient is unchanged', (select price from public.ingredients where id = pg_temp.ing('Gelas')::uuid) = 1200);

-- ================================================================ recipe RPCs and product save
select pg_temp.ok('R1 owners may call the recipe functions, anon may not',
  has_function_privilege('authenticated', 'public.owner_preview_recipe(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_get_recipe(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_save_product(uuid, uuid, uuid, text, numeric, numeric, numeric, public.product_station, boolean, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.owner_save_product(uuid, uuid, uuid, text, numeric, numeric, numeric, public.product_station, boolean, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.apply_recipe(uuid, jsonb)', 'execute'));

select set_config('request.jwt.claim.sub', 'e8400000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.latte', public.owner_save_product(null, current_setting('t.o')::uuid, null, 'Es latte', 0, 25000, 0, 'bar', false, pg_temp.kopi_lines())::text, false);
reset role;
select pg_temp.ok('R2 a new product with a recipe takes the recipe HPP (Susu is Rp 20.000 now)',
  (select hpp from public.products where id = current_setting('t.latte')::uuid) = 6810
  and (select hpp_source from public.products where id = current_setting('t.latte')::uuid) = 'recipe'
  and (select count(*) from public.recipe_lines where product_id = current_setting('t.latte')::uuid) = 4);

-- Review focus 4: a sale made now keeps its hpp_unit when the ingredient is repriced later.
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Resep', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Resep'), false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
select set_config('t.tx', (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
  jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', current_setting('t.latte'), 'quantity', 1))),
  'cash', 1000000, null, 'r-sale-1', null, null) ->> 'transactionId'), false);
select public.owner_save_ingredient(current_setting('t.o')::uuid, pg_temp.ing('Susu cair')::uuid, 'Susu cair', 21000, 1, 'l');
reset role;
select pg_temp.ok('R5a repricing moved the product to 6960', (select hpp from public.products where id = current_setting('t.latte')::uuid) = 6960);
select pg_temp.ok('R5b the past sale still holds hpp_unit 6810', (select hpp_unit from public.transaction_items where transaction_id = current_setting('t.tx')::uuid) = 6810);

-- Review focus 2: a recipe product's HPP cannot be overwritten.
set role authenticated;
select public.owner_save_product(current_setting('t.latte')::uuid, current_setting('t.o')::uuid, null, 'Es latte', 1, 26000, 0, 'bar', false, null);
reset role;
select pg_temp.ok('R3a owner_save_product with another HPP leaves it (price still saved)',
  (select hpp from public.products where id = current_setting('t.latte')::uuid) = 6960
  and (select selling_price from public.products where id = current_setting('t.latte')::uuid) = 26000);
set role authenticated;
select public.update_product(current_setting('t.latte')::uuid, current_setting('t.o')::uuid, null, 'Es latte', 2, 26000, 0, 'bar', false);
reset role;
select pg_temp.ok('R3b update_product cannot overwrite it either', (select hpp from public.products where id = current_setting('t.latte')::uuid) = 6960);

set role authenticated;
select pg_temp.ok('R6 get recipe: source, four lines, total, not incomplete',
  public.owner_get_recipe(current_setting('t.latte')::uuid) ->> 'source' = 'recipe'
  and jsonb_array_length(public.owner_get_recipe(current_setting('t.latte')::uuid) -> 'lines') = 4
  and (public.owner_get_recipe(current_setting('t.latte')::uuid) ->> 'hpp')::numeric = 6960
  and (public.owner_get_recipe(current_setting('t.latte')::uuid) ->> 'incomplete')::boolean = false);
select pg_temp.ok('R6b preview matches the cost math', (public.owner_preview_recipe(current_setting('t.o')::uuid, pg_temp.kopi_lines()) ->> 'hpp')::numeric = 6960);

-- Validation: nothing half-saved, and a new product is not created either.
select pg_temp.fails('R7a same ingredient twice', format('select public.owner_save_product(null, %L, null, %L, 0, 1000, 0, %L, false, %L::jsonb)', current_setting('t.o'), 'Gagal', 'bar',
  jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing('Gelas'), 'qty', 1, 'unit', 'pcs'), jsonb_build_object('ingredientId', pg_temp.ing('Gelas'), 'qty', 2, 'unit', 'pcs'))::text), 'hanya boleh sekali');
select pg_temp.fails('R7b qty 0', format('select public.owner_save_product(null, %L, null, %L, 0, 1000, 0, %L, false, %L::jsonb)', current_setting('t.o'), 'Gagal', 'bar',
  jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing('Gelas'), 'qty', 0, 'unit', 'pcs'))::text), 'Jumlah bahan tidak valid');
select pg_temp.fails('R7c qty with 4 decimals', format('select public.owner_save_product(null, %L, null, %L, 0, 1000, 0, %L, false, %L::jsonb)', current_setting('t.o'), 'Gagal', 'bar',
  jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing('Gelas'), 'qty', 1.2345, 'unit', 'pcs'))::text), 'Jumlah bahan tidak valid');
select pg_temp.fails('R7d 41 lines', format('select public.owner_save_product(null, %L, null, %L, 0, 1000, 0, %L, false, %L::jsonb)', current_setting('t.o'), 'Gagal', 'bar',
  (select jsonb_agg(jsonb_build_object('ingredientId', pg_temp.ing('Gelas'), 'qty', 1, 'unit', 'pcs')) from generate_series(1, 41))::text), 'maksimal 40');
select pg_temp.fails('R7e unit of another family', format('select public.owner_save_product(null, %L, null, %L, 0, 1000, 0, %L, false, %L::jsonb)', current_setting('t.o'), 'Gagal', 'bar',
  jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing('Gelas'), 'qty', 1, 'unit', 'g'))::text), 'Satuan tidak cocok');
select pg_temp.fails('R7f unknown ingredient', format('select public.owner_save_product(null, %L, null, %L, 0, 1000, 0, %L, false, %L::jsonb)', current_setting('t.o'), 'Gagal', 'bar',
  jsonb_build_array(jsonb_build_object('ingredientId', gen_random_uuid(), 'qty', 1, 'unit', 'pcs'))::text), 'tidak ditemukan');
reset role;
select pg_temp.ok('R7g no product "Gagal" was created by the failed saves', not exists (select 1 from public.products where name = 'Gagal'));

-- A Rp 0 ingredient still gives a recipe product, flagged as an estimate.
set role authenticated;
select set_config('t.free', public.owner_save_product(null, current_setting('t.o')::uuid, null, 'Air putih', 0, 3000, 0, 'bar', false,
  jsonb_build_array(jsonb_build_object('ingredientId', pg_temp.ing('Gratis'), 'qty', 5, 'unit', 'g')))::text, false);
select pg_temp.ok('R8 Rp 0 ingredient: recipe source, incomplete, HPP 0',
  public.owner_get_recipe(current_setting('t.free')::uuid) ->> 'source' = 'recipe'
  and (public.owner_get_recipe(current_setting('t.free')::uuid) ->> 'incomplete')::boolean
  and (public.owner_get_recipe(current_setting('t.free')::uuid) ->> 'hpp')::numeric = 0);

-- A manual product is saved as before.
select public.owner_save_product(current_setting('t.p2')::uuid, current_setting('t.o')::uuid, null, 'Roti bakar', 5500, 15000, 100, 'kitchen', true, null);
reset role;
select pg_temp.ok('R9 manual product: p_hpp applies, recipe null leaves it manual',
  (select hpp from public.products where id = current_setting('t.p2')::uuid) = 5500
  and (select hpp_source from public.products where id = current_setting('t.p2')::uuid) = 'manual');

-- Review focus 3: removing the recipe keeps the last HPP and hands the field back to the owner.
set role authenticated;
select public.owner_save_product(current_setting('t.latte')::uuid, current_setting('t.o')::uuid, null, 'Es latte', 1, 26000, 0, 'bar', false, '[]'::jsonb);
reset role;
select pg_temp.ok('R4a recipe removed: manual, last HPP kept, no lines',
  (select hpp from public.products where id = current_setting('t.latte')::uuid) = 6960
  and (select hpp_source from public.products where id = current_setting('t.latte')::uuid) = 'manual'
  and not exists (select 1 from public.recipe_lines where product_id = current_setting('t.latte')::uuid));
set role authenticated;
select public.owner_save_product(current_setting('t.latte')::uuid, current_setting('t.o')::uuid, null, 'Es latte', 7000, 26000, 0, 'bar', false, null);
reset role;
select pg_temp.ok('R4b after that, a typed HPP applies again', (select hpp from public.products where id = current_setting('t.latte')::uuid) = 7000);

-- Another business cannot read or preview a recipe.
select set_config('request.jwt.claim.sub', 'e8400000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.fails('X3a get recipe', format('select public.owner_get_recipe(%L)', current_setting('t.free')), 'Sesi kasir tidak valid');
select pg_temp.fails('X3b preview recipe', format('select public.owner_preview_recipe(%L, %L::jsonb)', current_setting('t.o'), '[]'), 'Sesi kasir tidak valid');
select pg_temp.fails('X3c save product with a recipe', format('select public.owner_save_product(%L, %L, null, %L, 0, 1000, 0, %L, false, %L::jsonb)', current_setting('t.free'), current_setting('t.o'), 'Air putih', 'bar', '[]'), 'Sesi kasir tidak valid');
reset role;

-- ================================================================ the stock book stays consistent (P7) when a recipe product's HPP moves
create or replace function pg_temp.p7() returns jsonb language sql security definer as $$
  select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(
    public.owner_day_close(current_setting('t.o')::uuid, (now() at time zone 'Asia/Jakarta')::date) -> 'checks') f
  where f ->> 'rule' = 'P7'
$$;
select set_config('request.jwt.claim.sub', 'e8400000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.owner_save_product(current_setting('t.p')::uuid, current_setting('t.o')::uuid, null, 'Es kopi susu', 0, 22000, 100, 'kitchen', true, pg_temp.kopi_lines());
select public.owner_save_ingredient(current_setting('t.o')::uuid, pg_temp.ing('Susu cair')::uuid, 'Susu cair', 25000, 1, 'l');
reset role;
select pg_temp.ok('P7a a tracked recipe product moved with the ingredient price (18000 -> 25000 per liter adds 1050)', pg_temp.hpp() = 7560);
select pg_temp.ok('P7b the stock book has no P7 failure', pg_temp.p7() = '[]'::jsonb);
