-- Tests for 091 (tables: list, occupancy from held bills, rules for renaming, deactivating, moving a bill).
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
create or replace function pg_temp.item(pid text, q int) returns jsonb language sql as $$
  select jsonb_build_object('product_id', current_setting(pid), 'quantity', q)
$$;
-- One table as the list shows it.
create or replace function pg_temp.table_of(n text) returns jsonb language sql security definer as $$
  select x from jsonb_array_elements(public.list_tables(current_setting('t.o')::uuid)) x where x->>'name' = n
$$;
-- A held dine-in bill on a table, with one es kopi susu.
create or replace function pg_temp.hold(tbl text, k text) returns uuid language sql as $$
  select public.save_held_bill(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    jsonb_build_object('table_number', tbl, 'items', jsonb_build_array(pg_temp.item('t.kopi', 1))))
$$;

-- ================================================================ fixture
insert into auth.users(id, email) values ('91000000-0000-0000-0000-000000000001', 'meja@kopi.id'), ('91000000-0000-0000-0000-000000000002', 'lain@meja.id');
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Meja', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Sari', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Sari'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Es kopi susu', 6510, 22000, 100)::text, false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);
select public.owner_save_table(current_setting('t.o')::uuid, null, 'M1');
select public.owner_save_table(current_setting('t.o')::uuid, null, 'M2');
select public.owner_save_table(current_setting('t.o')::uuid, null, 'M3');
select set_config('t.m4', public.owner_save_table(current_setting('t.o')::uuid, null, 'M4')::text, false);
select set_config('t.m1', pg_temp.table_of('M1') ->> 'id', false);

-- ===== creating and naming
select pg_temp.fails('T1 same name in another spelling refused', format('select public.owner_save_table(%L, null, %L)', current_setting('t.o'), ' m1 '), 'sudah dipakai');
select pg_temp.fails('T2 empty name refused', format('select public.owner_save_table(%L, null, %L)', current_setting('t.o'), '  '), 'wajib diisi');
select pg_temp.fails('T3 name over 20 characters refused', format('select public.owner_save_table(%L, null, %L)', current_setting('t.o'), repeat('x', 21)), 'maksimal 20');
select pg_temp.ok('T4 four tables listed, all free and active',
  jsonb_array_length(public.list_tables(current_setting('t.o')::uuid)) = 4
  and not exists (select 1 from jsonb_array_elements(public.list_tables(current_setting('t.o')::uuid)) x where (x->>'occupied')::boolean or not (x->>'isActive')::boolean));
select pg_temp.fails('T5 tables are not writable directly', format('insert into public.tables(outlet_id, name) values (%L, %L)', current_setting('t.o'), 'Bebas'), 'permission denied');

-- ===== dine-in needs a table
select pg_temp.fails('T6 held bill without a table refused', $q$select public.save_held_bill(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, jsonb_build_object('table_number', ' ', 'items', jsonb_build_array(pg_temp.item('t.kopi', 1))))$q$, 'wajib punya meja');
select pg_temp.ok('T7 take-away paid at once needs no table',
  (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'cash', 50000, null, 't91-bawa', null, null) ->> 'total')::numeric = 22000);

-- ===== occupancy comes from held bills
select set_config('t.bill1', pg_temp.hold('M1', 'h91-1')::text, false);
select set_config('t.bill2', pg_temp.hold('M3', 'h91-2')::text, false);
select pg_temp.ok('T8 M1 occupied with its bill and total', (pg_temp.table_of('M1')->>'occupied')::boolean and (pg_temp.table_of('M1')->>'heldTotal')::numeric = 22000 and pg_temp.table_of('M1')->>'since' is not null);
select pg_temp.ok('T9 M2 still free', not (pg_temp.table_of('M2')->>'occupied')::boolean);
select pg_temp.fails('T10 occupied table cannot be renamed', format('select public.owner_save_table(%L, %L, %L)', current_setting('t.o'), current_setting('t.m1'), 'Teras'), 'Meja masih terisi');
select pg_temp.fails('T11 occupied table cannot be deactivated', format('select public.owner_set_table_active(%L, false)', current_setting('t.m1')), 'Meja masih terisi');
select pg_temp.ok('T12 renaming a free table is allowed', public.owner_save_table(current_setting('t.o')::uuid, current_setting('t.m4')::uuid, 'Teras') = current_setting('t.m4')::uuid);

-- ===== moving a bill
select pg_temp.fails('T13 move to an occupied table refused', format('select public.move_held_bill(%L, %L)', current_setting('t.bill1'), 'M3'), 'sudah terisi');
select pg_temp.fails('T14 move with no target refused', format('select public.move_held_bill(%L, %L)', current_setting('t.bill1'), ' '), 'Pilih meja tujuan');
select public.move_held_bill(current_setting('t.bill1')::uuid, 'M2');
select pg_temp.ok('T15 move to a free table', (select table_number = 'M2' from public.transactions where id = current_setting('t.bill1')::uuid));
select pg_temp.ok('T16 M2 now occupied, M1 free', (pg_temp.table_of('M2')->>'occupied')::boolean and not (pg_temp.table_of('M1')->>'occupied')::boolean);
select pg_temp.ok('T17 the bill keeps its total and moves with the same id', (select table_number = 'M2' and total = 22000 from public.transactions where id = current_setting('t.bill1')::uuid));
select public.move_held_bill(current_setting('t.bill1')::uuid, 'm2');
select pg_temp.ok('T18 move onto its own table is allowed', (select table_number = 'M2' from public.transactions where id = current_setting('t.bill1')::uuid));
select public.owner_set_table_active(current_setting('t.m1')::uuid, false);
select pg_temp.ok('T19 M1 can be deactivated once free', not (pg_temp.table_of('M1')->>'isActive')::boolean);
select pg_temp.fails('T20 move to an inactive table refused', format('select public.move_held_bill(%L, %L)', current_setting('t.bill1'), 'M1'), 'Meja tidak ditemukan');
select pg_temp.fails('T21 moving a paid bill refused', format('select public.move_held_bill(%L, %L)', (select id from public.transactions where status = 'completed' and outlet_id = current_setting('t.o')::uuid limit 1), 'M4'), 'tidak ditemukan');
select pg_temp.fails('T22 move of an unknown bill refused', format('select public.move_held_bill(%L, %L)', gen_random_uuid(), 'M4'), 'tidak ditemukan');

-- ===== editing a held bill cannot clear its table
select pg_temp.fails('T23 editing a held bill cannot clear its table', format('select public.update_held_bill(%L, %L::jsonb)', current_setting('t.bill2'), jsonb_build_object('table_number', ' ', 'items', jsonb_build_array(pg_temp.item('t.kopi', 1)))::text), 'wajib punya meja');
select pg_temp.ok('T24 editing a held bill keeps its table', public.update_held_bill(current_setting('t.bill2')::uuid, jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2)))) = current_setting('t.bill2')::uuid
  and (select table_number from public.transactions where id = current_setting('t.bill2')::uuid) = 'M3');

-- ===== deleting the bill frees the table
select public.delete_held_bill(current_setting('t.bill2')::uuid);
select pg_temp.ok('T25 deleting the bill frees M3', not (pg_temp.table_of('M3')->>'occupied')::boolean);

-- ===== isolation between businesses
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000002', false);
select set_config('t.reg2', public.register_business('Warung Lain', 'Cabang', null)::text, false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = (current_setting('t.reg2')::jsonb ->> 'business_id')::uuid;
set role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000002', false);
select pg_temp.fails('T26 other business cannot list the tables', format('select public.list_tables(%L)', current_setting('t.o')), 'Sesi kasir tidak valid');
select pg_temp.fails('T27 other business cannot save a table', format('select public.owner_save_table(%L, null, %L)', current_setting('t.o'), 'Asing'), 'Sesi kasir tidak valid');
select pg_temp.fails('T28 other business cannot deactivate a table', format('select public.owner_set_table_active(%L, false)', current_setting('t.m4')), 'Sesi kasir tidak valid');
select pg_temp.fails('T29 other business cannot move a bill', format('select public.move_held_bill(%L, %L)', current_setting('t.bill1'), 'M4'), 'Sesi kasir tidak valid');
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', false);
reset role;
