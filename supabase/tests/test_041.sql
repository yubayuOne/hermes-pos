-- Tests for 040 + 041 (expenses: one record per shift) on top of 001 to 043. Owner side since 043: test_043.sql.
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
create or replace function pg_temp.it(name text, category text, qty text, unit text, amount text) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'category', category, 'quantity', qty::numeric, 'unit', unit, 'amount', amount::numeric)
$$;
create or replace function pg_temp.rec(paid text, items jsonb, k text) returns jsonb language sql as $$
  select public.record_expense(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, paid, items, k)
$$;
create or replace function pg_temp.cash() returns numeric language sql as $$
  select (public.get_shift_cash_summary(current_setting('t.sh')::uuid) ->> 'expected_cash')::numeric
$$;

insert into auth.users(id, email) values ('d0000000-0000-0000-0000-000000000001', 'sari@kafe.id'), ('d0000000-0000-0000-0000-000000000002', 'budi@lain.id');
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kafe Sari', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Sari', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Sari'), false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 500000)::text, false);

-- A: from the drawer, 2 items. B: not from the drawer. Both land in the same shift record.
select set_config('t.a', pg_temp.rec('drawer', jsonb_build_array(pg_temp.it('Gula pasir', 'belanja', '2', 'kg', '36000'), pg_temp.it('Galon', 'operasional', '1.5', 'pcs', '20000')), 'e-a')::text, false);
select pg_temp.ok('E1 drawer expense: total 56.000, items in order, shift info',
  (current_setting('t.a')::jsonb ->> 'total')::numeric = 56000
  and current_setting('t.a')::jsonb -> 'items' -> 0 ->> 'name' = 'Gula pasir' and (current_setting('t.a')::jsonb -> 'items' -> 1 ->> 'quantity')::numeric = 1.5
  and current_setting('t.a')::jsonb -> 'items' -> 1 ->> 'paidFrom' = 'drawer'
  and (current_setting('t.a')::jsonb ->> 'shiftNumber')::int = 1 and (current_setting('t.a')::jsonb ->> 'shiftOpen')::boolean);
select pg_temp.ok('E2 drawer expense lowers expected cash: 500.000 - 56.000', pg_temp.cash() = 444000);
select pg_temp.ok('E3 replay with the same key: same record, nothing added, cash not taken twice',
  (pg_temp.rec('drawer', jsonb_build_array(pg_temp.it('Gula pasir', 'belanja', '2', 'kg', '36000')), 'e-a') ->> 'total')::numeric = 56000
  and pg_temp.cash() = 444000);
select set_config('t.bx', pg_temp.rec('other', jsonb_build_array(pg_temp.it('Listrik', 'operasional', '1', 'pcs', '150000')), 'e-b')::text, false);
select pg_temp.ok('E4 second entry joins the shift record: same id, 3 items, total 206.000, drawer 56.000',
  current_setting('t.bx')::jsonb ->> 'id' = current_setting('t.a')::jsonb ->> 'id'
  and jsonb_array_length(current_setting('t.bx')::jsonb -> 'items') = 3
  and current_setting('t.bx')::jsonb -> 'items' -> 2 ->> 'paidFrom' = 'other'
  and (current_setting('t.bx')::jsonb ->> 'total')::numeric = 206000 and (current_setting('t.bx')::jsonb ->> 'drawerTotal')::numeric = 56000);
select pg_temp.ok('E5 not from the drawer: cash unchanged', pg_temp.cash() = 444000);
select pg_temp.rec('drawer', jsonb_build_array(pg_temp.it('Es batu', 'belanja', '3', 'pack', '15000')), 'e-c');
select pg_temp.ok('E6 second drawer entry: one cash book row, 71.000', pg_temp.cash() = 429000);
reset role;
select pg_temp.ok('E7 one record and one cash book row for the shift',
  (select count(*) from public.expenses where shift_id = current_setting('t.sh')::uuid) = 1
  and (select count(*) from public.cash_ledger where source_type = 'expense' and shift_id = current_setting('t.sh')::uuid) = 1);
set role authenticated;

select pg_temp.fails('V1 unknown unit', $$select pg_temp.rec('drawer', jsonb_build_array(pg_temp.it('Es', 'belanja', '1', 'ton', '1000')), 'v1')$$, 'satuan');
select pg_temp.fails('V2 zero amount', $$select pg_temp.rec('drawer', jsonb_build_array(pg_temp.it('Es', 'belanja', '1', 'kg', '0')), 'v2')$$, 'lebih dari Rp0');
select pg_temp.fails('V3 amount with decimals', $$select pg_temp.rec('drawer', jsonb_build_array(pg_temp.it('Es', 'belanja', '1', 'kg', '1000.5')), 'v3')$$, 'tanpa koma');
select pg_temp.fails('V4 no items', $$select pg_temp.rec('drawer', '[]'::jsonb, 'v4')$$, 'minimal satu');
select pg_temp.fails('V5 unknown category', $$select pg_temp.rec('drawer', jsonb_build_array(pg_temp.it('Es', 'lain', '1', 'kg', '1000')), 'v5')$$, 'kategori');
select pg_temp.fails('V6 zero quantity', $$select pg_temp.rec('drawer', jsonb_build_array(pg_temp.it('Es', 'belanja', '0', 'kg', '1000')), 'v6')$$, 'lebih dari 0');
select pg_temp.fails('V7 empty name', $$select pg_temp.rec('drawer', jsonb_build_array(pg_temp.it('  ', 'belanja', '1', 'kg', '1000')), 'v7')$$, 'nama barang');
select pg_temp.fails('V8 unknown source', $$select pg_temp.rec('bank', jsonb_build_array(pg_temp.it('Es', 'belanja', '1', 'kg', '1000')), 'v8')$$, 'sumber uang');
select pg_temp.fails('V9 more than 30 items in one entry', format('select pg_temp.rec(%L, %L::jsonb, %L)', 'other',
  (select jsonb_agg(pg_temp.it('Es', 'belanja', '1', 'kg', '1000')) from generate_series(1, 31)), 'v9'), '30 barang');
select pg_temp.ok('V10 rejected input left nothing behind', jsonb_array_length(public.list_shift_expenses(current_setting('t.sh')::uuid) -> 0 -> 'items') = 4);
select pg_temp.ok('N1 owner notified once per entry', (select count(*) from jsonb_array_elements(public.list_notifications(50)) n where n->>'kind' = 'expense') = 3);

select pg_temp.ok('C1 close shift: expected cash counts the drawer expenses',
  (public.close_shift(current_setting('t.sh')::uuid, 429000) ->> 'variance')::numeric = 0);
select pg_temp.fails('C2 no expense on a closed shift', $$select pg_temp.rec('drawer', jsonb_build_array(pg_temp.it('Es', 'belanja', '1', 'kg', '1000')), 'e-d')$$, 'Shift aktif');
-- Owner list, edits, and other owners: test_043.sql (043 removed the review flow).

select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Budi', 'Satu', null);
select pg_temp.fails('X3 direct table read is refused', 'select count(*) from public.expenses', 'permission denied');

-- Expired subscription locks recording.
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-000000000001', false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
reset role;
update public.subscriptions set expires_at = now() - interval '1 day' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select pg_temp.fails('L1 expired: recording refused', $$select pg_temp.rec('drawer', jsonb_build_array(pg_temp.it('Es', 'belanja', '1', 'kg', '1000')), 'e-l')$$, 'Langganan berakhir');
reset role;
