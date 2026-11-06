-- Tests for 102 (the owner edits or deletes an expense item). Every line of output must start with PASS.
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
create or replace function pg_temp.qb(sql text) returns boolean language plpgsql security definer as $$
declare r boolean; begin execute sql into r; return coalesce(r, false); end $$;
create or replace function pg_temp.q(sql text) returns text language plpgsql security definer as $$
declare r text; begin execute sql into r; return r; end $$;

insert into auth.users(id, email) values ('10200000-0000-0000-0000-000000000001', 'pemilik@edit.id');
select set_config('request.jwt.claim.sub', '10200000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Warung Edit', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Dewi', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Dewi'), false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
select public.owner_save_expense_category(null, 'Belanja', true);
select set_config('t.gas', public.owner_save_barang(current_setting('t.o')::uuid, null, 'Gas LPG', 'pcs', true, 'Belanja')::text, false);
select set_config('t.gula', public.owner_save_barang(current_setting('t.o')::uuid, null, 'Gula', 'g', true, 'Belanja')::text, false);

-- The cashier's entry: 1 gas for 23.000 from the drawer, stock amount not yet given.
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'drawer', jsonb_build_array(jsonb_build_object(
  'name', 'Beli gas', 'quantity', 1, 'unit', 'pcs', 'amount', 23000, 'ingredientId', current_setting('t.gas'))));
select set_config('t.item', pg_temp.q(format('select id::text from public.expense_items where name = %L', 'Beli gas')), false);

-- E1: the owner corrects the price and the number of bottles; the total and the shift's cash follow.
select public.owner_update_expense_item(current_setting('t.item')::uuid, current_setting('t.gas')::uuid, null, null, null, 2, 46000, 2);
select pg_temp.ok('E1 editing the price and quantity changes the item and the total',
  pg_temp.qb(format('select quantity = 2 and amount = 46000 from public.expense_items where id = %L', current_setting('t.item')))
  and pg_temp.qb(format('select total = 46000 from public.expenses where shift_id = %L', current_setting('t.sh'))));
select pg_temp.ok('E1b the stock amount of 2 went into the gas stock', pg_temp.qb(format('select stock = 2 from public.ingredients where id = %L', current_setting('t.gas'))));

-- E2: the stock amount is corrected to 3; the old 2 comes out first.
select public.owner_update_expense_item(current_setting('t.item')::uuid, current_setting('t.gas')::uuid, null, null, null, 2, 46000, 3);
select pg_temp.ok('E2 changing the stock amount replaces the old one', pg_temp.qb(format('select stock = 3 from public.ingredients where id = %L', current_setting('t.gas')))); 

-- E3: the barang is changed to sugar: gas stock is put back, sugar gets the amount.
select public.owner_update_expense_item(current_setting('t.item')::uuid, current_setting('t.gula')::uuid, null, null, null, 1, 15000, 500);
select pg_temp.ok('E3 a new barang: the old stock comes back, the new one takes the amount',
  pg_temp.qb(format('select stock = 0 from public.ingredients where id = %L', current_setting('t.gas')))
  and pg_temp.qb(format('select stock = 500 and kategori = %L from public.ingredients where id = %L', 'Belanja', current_setting('t.gula'))));
select pg_temp.ok('E3b the item takes the barang name, category and unit',
  pg_temp.qb(format('select name = %L and category = %L and unit = %L from public.expense_items where id = %L', 'Gula', 'Belanja', 'g', current_setting('t.item'))));

-- E4: a barang lain needs a name and a unit, as on entry.
select pg_temp.fails('E4 a barang lain without a name is refused',
  format('select public.owner_update_expense_item(%L, null, %L, null, %L, 1, 5000, null)', current_setting('t.item'), '', 'pcs'), 'Tulis nama barang atau biaya');
select public.owner_update_expense_item(current_setting('t.item')::uuid, null, 'Kantong plastik', null, 'pcs', 1, 5000, null);
select pg_temp.ok('E4b a free-text item keeps its own name and no stock move remains',
  pg_temp.qb(format('select name = %L and ingredient_id is null from public.expense_items where id = %L', 'Kantong plastik', current_setting('t.item')))
  and pg_temp.qb(format('select stock = 0 from public.ingredients where id = %L', current_setting('t.gula'))));

-- E5: the barang moved after the item (another entry of sugar), so the item cannot be changed or deleted until that is undone.
select public.owner_update_expense_item(current_setting('t.item')::uuid, current_setting('t.gula')::uuid, null, null, null, 1, 15000, 500);
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(jsonb_build_object(
  'name', 'Gula tambahan', 'quantity', 1, 'unit', 'g', 'amount', 4000, 'ingredientId', current_setting('t.gula'), 'stockQty', 100)));
select pg_temp.fails('E5 an item whose barang moved afterwards cannot be changed',
  format('select public.owner_update_expense_item(%L, %L, null, null, null, 1, 9000, 500)', current_setting('t.item'), current_setting('t.gula')), 'Sudah ada pergerakan stok setelahnya');
select pg_temp.fails('E5b nor deleted',
  format('select public.owner_delete_expense_item(%L)', current_setting('t.item')), 'Sudah ada pergerakan stok setelahnya');
select public.owner_delete_expense_item(pg_temp.q(format('select id::text from public.expense_items where name = %L', 'Gula tambahan'))::uuid);
select public.owner_delete_expense_item(current_setting('t.item')::uuid);
select pg_temp.ok('E6 deleting the item takes its stock back and removes it',
  not pg_temp.qb(format('select exists (select 1 from public.expense_items where id = %L)', current_setting('t.item')))
  and pg_temp.qb(format('select stock = 0 from public.ingredients where id = %L', current_setting('t.gula'))));
select pg_temp.ok('E6b the expense total follows', pg_temp.qb(format('select total = 0 from public.expenses where shift_id = %L', current_setting('t.sh'))));
reset role;
