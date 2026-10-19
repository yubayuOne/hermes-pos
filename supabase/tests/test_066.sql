-- Tests for 066 (owner void, sales per product) on top of 001 to the latest migration.
-- The owner's item, payment, and detail edits from 066 were removed in 071 (balancing instead; see test_071).
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
create or replace function pg_temp.item(pid text, q int, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('product_id', current_setting(pid), 'quantity', q) || extra
$$;
create or replace function pg_temp.pay(payload jsonb, k text, method text default 'cash') returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    payload, method::public.payment_method, 1000000, null, k, null, null) ->> 'transactionId')::uuid
$$;
create or replace function pg_temp.cash() returns numeric language sql as $$
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) from public.cash_ledger where shift_id = current_setting('t.sh')::uuid
$$;
create or replace function pg_temp.stock(pid text) returns numeric language sql as $$
  select stock from public.products where id = current_setting(pid)::uuid
$$;

select pg_temp.ok('S1 anon cannot void; signed-in owners can', not has_function_privilege('anon', 'public.owner_void_bill(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_void_bill(uuid, text)', 'execute'));
select pg_temp.ok('S2 helpers are internal', not has_function_privilege('authenticated', 'public._066_owner_bill(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public._066_recount_shift(uuid)', 'execute'));

insert into auth.users(id, email) values ('e6600000-0000-0000-0000-000000000001', 'sari@kedai.id'), ('e6600000-0000-0000-0000-000000000002', 'joko@lain.id');
select set_config('request.jwt.claim.sub', 'e6600000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kedai Sari', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Sari', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Sari'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select set_config('t.roti', public.create_product(current_setting('t.o')::uuid, null, 'Roti bakar', 6000, 18000, 100)::text, false);
select set_config('t.teh', public.create_product(current_setting('t.o')::uuid, null, 'Teh racik', 3000, 10000, 0, 'bar', false)::text, false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);

-- A: 2 kopi + 1 roti, bill discount 10%: 55.800 cash. C: 2 kopi at 10% + 1 roti minus 5.000: 52.600 QRIS. B: 1 kopi cash.
select set_config('t.a', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2), pg_temp.item('t.roti', 1)),
  'bill_discount_type', 'percent', 'bill_discount_value', 10), 'p-a')::text, false);
select set_config('t.cc', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(
  pg_temp.item('t.kopi', 2, '{"discount_type": "percent", "discount_value": 10}'),
  pg_temp.item('t.roti', 1, '{"discount_type": "amount", "discount_value": 5000}'))), 'p-c', 'qris')::text, false);
select set_config('t.bb', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'p-b')::text, false);
select pg_temp.ok('B1 start: cash 100.000 + 55.800 + 22.000, kopi stock 95', pg_temp.cash() = 177800 and pg_temp.stock('t.kopi') = 95);

-- ===== refunded bills cannot be voided
select public.refund_items_approved(current_setting('t.bb')::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting('t.bb')::uuid), 'quantity', 1, 'restock', false)),
  'cash', 'Salah pesan', '271828', 'r-1');
select pg_temp.fails('F1 refunded: no void', format('select public.owner_void_bill(%L, %L)', current_setting('t.bb'), 'salah input'), 'sudah direfund');

-- ===== void on a closed shift
select set_config('t.e', pg_temp.cash()::text, false);
select public.close_shift(current_setting('t.sh')::uuid, current_setting('t.e')::numeric);
select pg_temp.fails('X1 reason required', format('select public.owner_void_bill(%L, %L)', current_setting('t.a'), 'x'), 'Alasan');
select public.owner_void_bill(current_setting('t.a')::uuid, 'Pesanan dobel');
select pg_temp.ok('X2 voided after closing: expected cash -55.800, counted stays, variance +55.800',
  (select expected_cash = current_setting('t.e')::numeric - 55800 and closing_cash = current_setting('t.e')::numeric and variance = 55800
   from public.shifts where id = current_setting('t.sh')::uuid));
select pg_temp.ok('X3 bill voided with its reason, stock back: kopi 97, roti 99',
  (select status = 'voided' and void_reason = 'Pesanan dobel' from public.transactions where id = current_setting('t.a')::uuid)
  and pg_temp.stock('t.kopi') = 97 and pg_temp.stock('t.roti') = 99);
select pg_temp.fails('X4 a voided bill cannot be voided again', format('select public.owner_void_bill(%L, %L)', current_setting('t.a'), 'lagi lagi'), 'sudah dibayar');

-- ===== sales per product
select set_config('t.ps', public.owner_product_sales(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day')::text, false);
select pg_temp.ok('Q1 kopi on C and B: 3 sold, 39.600 + 22.000 = 61.600 (voided A left out, refund not subtracted)',
  (current_setting('t.ps')::jsonb -> current_setting('t.kopi') ->> 'qty')::numeric = 3
  and (current_setting('t.ps')::jsonb -> current_setting('t.kopi') ->> 'sales')::numeric = 61600);
select pg_temp.ok('Q2 roti on C: 1 sold, 13.000', (current_setting('t.ps')::jsonb -> current_setting('t.roti') ->> 'qty')::numeric = 1
  and (current_setting('t.ps')::jsonb -> current_setting('t.roti') ->> 'sales')::numeric = 13000);
select pg_temp.ok('Q3 teh never sold: not listed', current_setting('t.ps')::jsonb -> current_setting('t.teh') is null);

-- ===== other owners and expired plans
select set_config('request.jwt.claim.sub', 'e6600000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Joko', 'Satu', null);
select pg_temp.fails('O1 other owner cannot void', format('select public.owner_void_bill(%L, %L)', current_setting('t.cc'), 'bukan punya'), 'tidak ditemukan');
select set_config('request.jwt.claim.sub', 'e6600000-0000-0000-0000-000000000001', false);
reset role;
update public.subscriptions set expires_at = now() - interval '1 day' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select pg_temp.fails('O2 expired plan cannot void', format('select public.owner_void_bill(%L, %L)', current_setting('t.cc'), 'salah input'), 'Langganan berakhir');
reset role;
