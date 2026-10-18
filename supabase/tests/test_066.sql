-- Tests for 066 (owner bill edits, sales per product) on top of 001 to 066.
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
-- The bill's line of product `pid`, as an edit entry with a new quantity.
create or replace function pg_temp.line(tx text, pid text, q int) returns jsonb language sql as $$
  select jsonb_build_object('itemId', (select id from public.transaction_items where transaction_id = current_setting(tx)::uuid
    and product_id = current_setting(pid)::uuid), 'quantity', q)
$$;
create or replace function pg_temp.items(tx text, items jsonb) returns jsonb language sql as $$
  select public.owner_update_bill_items(current_setting(tx)::uuid, items, 'koreksi kasir')
$$;
create or replace function pg_temp.cash() returns numeric language sql as $$
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) from public.cash_ledger where shift_id = current_setting('t.sh')::uuid
$$;
create or replace function pg_temp.total(tx text) returns numeric language sql as $$
  select total from public.transactions where id = current_setting(tx)::uuid
$$;
create or replace function pg_temp.stock(pid text) returns numeric language sql as $$
  select stock from public.products where id = current_setting(pid)::uuid
$$;

select pg_temp.ok('S1 anon cannot call the edits', not has_function_privilege('anon', 'public.owner_void_bill(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.owner_set_bill_payment(uuid, public.payment_method, text)', 'execute')
  and not has_function_privilege('anon', 'public.owner_update_bill_details(uuid, text, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.owner_update_bill_items(uuid, jsonb, text)', 'execute'));
select pg_temp.ok('S2 signed-in owners can', has_function_privilege('authenticated', 'public.owner_update_bill_items(uuid, jsonb, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_void_bill(uuid, text)', 'execute'));
select pg_temp.ok('S3 helpers are internal', not has_function_privilege('authenticated', 'public._066_owner_bill(uuid, text)', 'execute')
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
select set_config('t.es', public.create_product(current_setting('t.o')::uuid, null, 'Es jeruk', 2000, 12000, 1)::text, false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);

-- A: 2 kopi + 1 roti, bill discount 10%: 62.000 -> 55.800 cash. C: 2 kopi at 10% + 1 roti minus 5.000: 52.600 QRIS.
select set_config('t.a', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2), pg_temp.item('t.roti', 1)),
  'bill_discount_type', 'percent', 'bill_discount_value', 10), 'p-a')::text, false);
select set_config('t.cc', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(
  pg_temp.item('t.kopi', 2, '{"discount_type": "percent", "discount_value": 10}'),
  pg_temp.item('t.roti', 1, '{"discount_type": "amount", "discount_value": 5000}'))), 'p-c', 'qris')::text, false);
select set_config('t.bb', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'p-b')::text, false);
select pg_temp.ok('B1 start: A 55.800, C 52.600, cash 100.000 + 55.800 + 22.000, kopi stock 95',
  pg_temp.total('t.a') = 55800 and pg_temp.total('t.cc') = 52600 and pg_temp.cash() = 177800 and pg_temp.stock('t.kopi') = 95);

-- ===== items
select pg_temp.fails('I1 quantity must be a whole number', $q$select pg_temp.items('t.a', '[{"itemId": "00000000-0000-0000-0000-000000000000", "quantity": "1.5"}]')$q$, 'Data item tidak valid');
select pg_temp.fails('I2 an item of another bill', $q$select pg_temp.items('t.a', jsonb_build_array(pg_temp.line('t.bb', 't.kopi', 1)))$q$, 'Item tidak ada');
select pg_temp.fails('I3 the same line twice', $q$select pg_temp.items('t.a', jsonb_build_array(pg_temp.line('t.a', 't.kopi', 1), pg_temp.line('t.a', 't.kopi', 2)))$q$, 'Data item tidak valid');
select pg_temp.fails('I4 everything removed', $q$select pg_temp.items('t.a', jsonb_build_array(pg_temp.line('t.a', 't.kopi', 0)))$q$, 'Bill kosong');
select pg_temp.fails('I5 not enough stock', $q$select pg_temp.items('t.a', jsonb_build_array(pg_temp.line('t.a', 't.kopi', 2), jsonb_build_object('productId', current_setting('t.es'), 'quantity', 2)))$q$, 'Stok produk');
select pg_temp.fails('I6 empty list', $q$select pg_temp.items('t.a', '[]')$q$, 'minimal satu');
select pg_temp.ok('I7 failed edits changed nothing', pg_temp.total('t.a') = 55800 and pg_temp.stock('t.kopi') = 95 and pg_temp.stock('t.es') = 1 and pg_temp.cash() = 177800);

-- A: kopi 2 -> 1, roti left out (removed), new teh 1: 22.000 + 10.000 = 32.000, bill discount 10% -> 28.800.
select set_config('t.r', pg_temp.items('t.a', jsonb_build_array(pg_temp.line('t.a', 't.kopi', 1),
  jsonb_build_object('productId', current_setting('t.teh'), 'quantity', 1)))::text, false);
select pg_temp.ok('I8 new total 28.800 from the server, previous 55.800', (current_setting('t.r')::jsonb ->> 'total')::numeric = 28800
  and (current_setting('t.r')::jsonb ->> 'previousTotal')::numeric = 55800 and pg_temp.total('t.a') = 28800);
select pg_temp.ok('I9 subtotal 32.000, bill discount 3.200, hpp 8.000 + 3.000',
  (select subtotal = 32000 and bill_discount = 3200 and total_hpp = 11000 from public.transactions where id = current_setting('t.a')::uuid));
select pg_temp.ok('I10 stock follows: kopi 96, roti back to 99, teh untracked',
  pg_temp.stock('t.kopi') = 96 and pg_temp.stock('t.roti') = 99 and pg_temp.stock('t.teh') = 0);
select pg_temp.ok('I11 cash book: 177.800 - 55.800 + 28.800 = 150.800', pg_temp.cash() = 150800);
select pg_temp.ok('I12 cash payment keeps what was handed over, change follows',
  (select amount_received = 1000000 and change_amount = 971200 from public.payments where transaction_id = current_setting('t.a')::uuid));

-- C: kopi 2 -> 3 (10% -> 6.600), roti 1 -> 2 (amount 5.000 stays): 66.000 - 6.600 + 36.000 - 5.000 = 90.400 QRIS.
select pg_temp.items('t.cc', jsonb_build_array(pg_temp.line('t.cc', 't.kopi', 3), pg_temp.line('t.cc', 't.roti', 2)));
select pg_temp.ok('I13 line discounts: percent recomputed, amount kept; total 90.400',
  pg_temp.total('t.cc') = 90400
  and (select discount_amount from public.transaction_items where transaction_id = current_setting('t.cc')::uuid and product_id = current_setting('t.kopi')::uuid) = 6600
  and (select discount_amount from public.transaction_items where transaction_id = current_setting('t.cc')::uuid and product_id = current_setting('t.roti')::uuid) = 5000);
select pg_temp.ok('I14 QRIS: received = total, cash book untouched', pg_temp.cash() = 150800
  and (select amount_received = 90400 and change_amount = 0 from public.payments where transaction_id = current_setting('t.cc')::uuid));

-- ===== payment method
select pg_temp.fails('P1 only cash or QRIS', format('select public.owner_set_bill_payment(%L, %L, ''salah pilih'')', current_setting('t.cc'), 'card'), 'Metode bayar');
select public.owner_set_bill_payment(current_setting('t.cc')::uuid, 'cash', 'salah pilih');
select pg_temp.ok('P2 C to cash: +90.400 in the drawer, no change', pg_temp.cash() = 241200
  and (select method = 'cash' and amount_received = 90400 and change_amount = 0 from public.payments where transaction_id = current_setting('t.cc')::uuid)
  and (select payment_method = 'cash' from public.transactions where id = current_setting('t.cc')::uuid));
select public.owner_set_bill_payment(current_setting('t.cc')::uuid, 'qris', 'salah pilih');
select pg_temp.ok('P3 back to QRIS: drawer as before', pg_temp.cash() = 150800);

-- ===== details
select public.owner_update_bill_details(current_setting('t.a')::uuid, '  Bu Ani ', 'A3', jsonb_build_object(
  (select id::text from public.transaction_items where transaction_id = current_setting('t.a')::uuid and product_id = current_setting('t.kopi')::uuid), ' kurang manis '));
select pg_temp.ok('D1 name, table, and note saved trimmed',
  (select customer_name = 'Bu Ani' and table_number = 'A3' from public.transactions where id = current_setting('t.a')::uuid)
  and (select note from public.transaction_items where transaction_id = current_setting('t.a')::uuid and product_id = current_setting('t.kopi')::uuid) = 'kurang manis');
select pg_temp.fails('D2 table at most 6', format('select public.owner_update_bill_details(%L, %L, %L, null)', current_setting('t.a'), 'Ani', 'MEJA123'), 'maksimal 6');
select pg_temp.fails('D3 note for an item of another bill', format('select public.owner_update_bill_details(%L, %L, %L, %L)', current_setting('t.a'), '', '',
  jsonb_build_object((select id::text from public.transaction_items where transaction_id = current_setting('t.bb')::uuid), 'x')), 'Item tidak ada');

-- ===== refunded bills keep their money
select public.refund_items_approved(current_setting('t.bb')::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting('t.bb')::uuid), 'quantity', 1, 'restock', false)),
  'cash', 'Salah pesan', '271828', 'r-1');
select pg_temp.fails('F1 refunded: no payment change', format('select public.owner_set_bill_payment(%L, %L, ''salah pilih'')', current_setting('t.bb'), 'qris'), 'sudah direfund');
select pg_temp.fails('F2 refunded: no item change', $q$select pg_temp.items('t.bb', jsonb_build_array(pg_temp.line('t.bb', 't.kopi', 2)))$q$, 'sudah direfund');
select pg_temp.fails('F3 refunded: no void', format('select public.owner_void_bill(%L, %L)', current_setting('t.bb'), 'salah input'), 'sudah direfund');
select pg_temp.ok('F4 details still allowed', (public.owner_update_bill_details(current_setting('t.bb')::uuid, 'Pak Budi', '', null) ->> 'number') is not null);

-- ===== voucher bills keep their items
select public.owner_save_voucher(null, 'POTONG5K', 'bill', 'amount', 5000, 0, null, (now() at time zone 'Asia/Jakarta')::date + 10, null);
select set_config('t.v', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.roti', 1)), 'voucher_code', 'POTONG5K'), 'p-v')::text, false);
select pg_temp.fails('V1 voucher bill: no item change', $q$select pg_temp.items('t.v', jsonb_build_array(pg_temp.line('t.v', 't.roti', 2)))$q$, 'voucher');

-- ===== void on a closed shift
select set_config('t.e', pg_temp.cash()::text, false);
select public.close_shift(current_setting('t.sh')::uuid, current_setting('t.e')::numeric);
select pg_temp.fails('X1 reason required', format('select public.owner_void_bill(%L, %L)', current_setting('t.a'), 'x'), 'Alasan');
select public.owner_void_bill(current_setting('t.a')::uuid, 'Pesanan dobel');
select pg_temp.ok('X2 voided after closing: expected cash -28.800, counted stays, variance +28.800',
  (select expected_cash = current_setting('t.e')::numeric - 28800 and closing_cash = current_setting('t.e')::numeric and variance = 28800
   from public.shifts where id = current_setting('t.sh')::uuid));
select pg_temp.ok('X3 bill voided with its reason, kopi back to 96 (C took one more)',
  (select status = 'voided' and void_reason = 'Pesanan dobel' from public.transactions where id = current_setting('t.a')::uuid) and pg_temp.stock('t.kopi') = 96);
select pg_temp.fails('X4 a voided bill cannot be edited', $q$select pg_temp.items('t.a', jsonb_build_array(pg_temp.line('t.a', 't.kopi', 1)))$q$, 'sudah dibayar');
select pg_temp.items('t.cc', jsonb_build_array(pg_temp.line('t.cc', 't.kopi', 3), pg_temp.line('t.cc', 't.roti', 1)));
select pg_temp.ok('X5 item edit on a closed shift: QRIS bill, expected cash unchanged', pg_temp.total('t.cc') = 72400
  and (select expected_cash = current_setting('t.e')::numeric - 28800 from public.shifts where id = current_setting('t.sh')::uuid));

-- ===== sales per product
select set_config('t.ps', public.owner_product_sales(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day')::text, false);
select pg_temp.ok('Q1 kopi on C and B: 4 sold, 59.400 + 22.000 = 81.400 (voided A left out, refund not subtracted)',
  (current_setting('t.ps')::jsonb -> current_setting('t.kopi') ->> 'qty')::numeric = 4
  and (current_setting('t.ps')::jsonb -> current_setting('t.kopi') ->> 'sales')::numeric = 81400);
select pg_temp.ok('Q2 roti on C and the voucher bill: 2 sold, 13.000 + 18.000', (current_setting('t.ps')::jsonb -> current_setting('t.roti') ->> 'qty')::numeric = 2
  and (current_setting('t.ps')::jsonb -> current_setting('t.roti') ->> 'sales')::numeric = 31000);
select pg_temp.ok('Q3 teh only on the voided bill: not listed', current_setting('t.ps')::jsonb -> current_setting('t.teh') is null);

-- ===== other owners and expired plans
select set_config('request.jwt.claim.sub', 'e6600000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Joko', 'Satu', null);
select pg_temp.fails('O1 other owner cannot void', format('select public.owner_void_bill(%L, %L)', current_setting('t.cc'), 'bukan punya'), 'tidak ditemukan');
select pg_temp.fails('O2 other owner cannot edit items', $q$select pg_temp.items('t.cc', jsonb_build_array(pg_temp.line('t.cc', 't.kopi', 1)))$q$, 'tidak ditemukan');
select set_config('request.jwt.claim.sub', 'e6600000-0000-0000-0000-000000000001', false);
reset role;
update public.subscriptions set expires_at = now() - interval '1 day' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select pg_temp.fails('O3 expired plan cannot edit', format('select public.owner_set_bill_payment(%L, %L, ''salah pilih'')', current_setting('t.cc'), 'cash'), 'Langganan berakhir');
reset role;
