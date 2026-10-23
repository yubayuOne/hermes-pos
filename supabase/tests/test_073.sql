-- Tests for 073 (bill correction, cash in and out of the drawer, expense cancel and add, Tutup hari data).
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
create or replace function pg_temp.line(tx text, pid text, q int) returns jsonb language sql as $$
  select jsonb_build_object('itemId', (select id from public.transaction_items where transaction_id = current_setting(tx)::uuid
    and product_id = current_setting(pid)::uuid), 'quantity', q)
$$;
create or replace function pg_temp.cash() returns numeric language sql as $$
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) from public.cash_ledger where shift_id = current_setting('t.sh')::uuid
$$;
create or replace function pg_temp.stock(pid text) returns numeric language sql as $$
  select stock from public.products where id = current_setting(pid)::uuid
$$;
create or replace function pg_temp.day() returns jsonb language sql as $$
  select public.owner_day_close(current_setting('t.o')::uuid, (select business_date from public.shifts where id = current_setting('t.sh')::uuid))
$$;

select pg_temp.ok('S1 owner functions: signed-in yes, anon no',
  has_function_privilege('authenticated', 'public.owner_correct_bill(uuid, jsonb, public.payment_method, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.owner_correct_bill(uuid, jsonb, public.payment_method, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_add_cash_movement(uuid, text, numeric, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_cancel_expense_item(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_add_expense_items(uuid, text, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_day_close(uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.owner_day_close(uuid, date)', 'execute'));
select pg_temp.ok('S2 records are closed to clients; 071 writes are gone',
  not has_table_privilege('authenticated', 'public.cash_movements', 'select')
  and not has_table_privilege('authenticated', 'public.expense_item_cancellations', 'select')
  and to_regprocedure('public.owner_add_shift_adjustment(uuid, text, numeric, text, text)') is null);

insert into auth.users(id, email) values ('e7300000-0000-0000-0000-000000000001', 'kiki@kopi.id'), ('e7300000-0000-0000-0000-000000000002', 'lala@lain.id');
select set_config('request.jwt.claim.sub', 'e7300000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Kiki', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Kiki', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Kiki'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select set_config('t.roti', public.create_product(current_setting('t.o')::uuid, null, 'Roti bakar', 6000, 18000, 100)::text, false);
select set_config('t.teh', public.create_product(current_setting('t.o')::uuid, null, 'Teh racik', 3000, 10000, 0, 'bar', false)::text, false);
select set_config('t.es', public.create_product(current_setting('t.o')::uuid, null, 'Es jeruk', 2000, 12000, 1)::text, false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);

-- A: 2 kopi + 1 roti, bill discount 10%: 55.800 cash.
select set_config('t.a', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2), pg_temp.item('t.roti', 1)),
  'bill_discount_type', 'percent', 'bill_discount_value', 10), 'p-a')::text, false);
select pg_temp.ok('B1 start: cash 155.800, kopi 98, roti 99', pg_temp.cash() = 155800 and pg_temp.stock('t.kopi') = 98 and pg_temp.stock('t.roti') = 99);

-- ===== bill correction
select pg_temp.fails('K1 reason required', format('select public.owner_correct_bill(%L, %L, %L, %L, %L, %L)', current_setting('t.a'),
  jsonb_build_array(pg_temp.line('t.a', 't.kopi', 1)), 'cash', '', '', 'x'), 'Alasan');
select pg_temp.fails('K2 not enough stock rolls everything back', format('select public.owner_correct_bill(%L, %L, %L, %L, %L, %L)', current_setting('t.a'),
  jsonb_build_array(pg_temp.line('t.a', 't.kopi', 2), jsonb_build_object('productId', current_setting('t.es'), 'quantity', 2)), 'cash', '', '', 'Salah input'), 'Stok');
select pg_temp.ok('K3 after the refused correction the bill is untouched',
  (select status = 'completed' from public.transactions where id = current_setting('t.a')::uuid) and pg_temp.cash() = 155800 and pg_temp.stock('t.kopi') = 98);
-- Kopi 2 -> 1, roti out, teh 1 in, paid by QRIS, name and table: 22.000 + 10.000 = 32.000 - 10% = 28.800.
select set_config('t.k', public.owner_correct_bill(current_setting('t.a')::uuid,
  jsonb_build_array(pg_temp.line('t.a', 't.kopi', 1), jsonb_build_object('productId', current_setting('t.teh'), 'quantity', 1)),
  'qris', ' Bu Ani ', 'A3', '  Salah input pesanan ')::text, false);
select set_config('t.n', current_setting('t.k')::jsonb ->> 'id', false);
select pg_temp.ok('K4 new bill 28.800 by QRIS, previous 55.800', (current_setting('t.k')::jsonb ->> 'total')::numeric = 28800
  and (current_setting('t.k')::jsonb ->> 'previousTotal')::numeric = 55800
  and (select payment_method = 'qris' and status = 'completed' and customer_name = 'Bu Ani' and table_number = 'A3'
         and corrects_transaction_id = current_setting('t.a')::uuid from public.transactions where id = current_setting('t.n')::uuid));
select pg_temp.ok('K5 the original is voided with the reason; the new bill keeps its day and shift',
  (select status = 'voided' and void_reason = 'Dikoreksi: Salah input pesanan' from public.transactions where id = current_setting('t.a')::uuid)
  and (select n.created_at = a.created_at and n.shift_id = a.shift_id and substr(n.number, 1, 14) = substr(a.number, 1, 14)
       from public.transactions n, public.transactions a where n.id = current_setting('t.n')::uuid and a.id = current_setting('t.a')::uuid));
select pg_temp.ok('K6 cash 100.000 (A left the drawer), stock kopi 99, roti 100, discount split again',
  pg_temp.cash() = 100000 and pg_temp.stock('t.kopi') = 99 and pg_temp.stock('t.roti') = 100
  and (select sum(bill_discount_share) from public.transaction_items where transaction_id = current_setting('t.n')::uuid) = 3200);
select pg_temp.ok('K7 one correction in the log, before and after',
  (select jsonb_array_length(e) = 1 and e -> 0 ->> 'kind' = 'correction' and (e -> 0 -> 'before' ->> 'total')::numeric = 55800
     and (e -> 0 -> 'after' ->> 'total')::numeric = 28800
   from (select public.owner_list_bill_edits(current_setting('t.a')::uuid) as e) x));
select pg_temp.ok('K8 the list links both bills',
  (select r ->> 'correctsNumber' from jsonb_array_elements(public.owner_list_bills(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day', 'all') -> 'rows') r
   where r ->> 'id' = current_setting('t.n')) = (select number from public.transactions where id = current_setting('t.a')::uuid)
  and (select r ->> 'correctedByNumber' from jsonb_array_elements(public.owner_list_bills(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day', 'all') -> 'rows') r
   where r ->> 'id' = current_setting('t.a')) = (select number from public.transactions where id = current_setting('t.n')::uuid));
select pg_temp.fails('K9 a voided bill cannot be corrected', format('select public.owner_correct_bill(%L, %L, %L, %L, %L, %L)', current_setting('t.a'),
  jsonb_build_array(pg_temp.line('t.a', 't.kopi', 1)), 'cash', '', '', 'Lagi lagi'), 'sudah dibayar');

-- Refused: refunded and voucher bills.
select set_config('t.r', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'p-r')::text, false);
select public.refund_items_approved(current_setting('t.r')::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting('t.r')::uuid), 'quantity', 1, 'restock', true)),
  'cash', 'Salah pesan', '271828', 'rf-1');
select pg_temp.fails('K10 refunded bill', format('select public.owner_correct_bill(%L, %L, %L, %L, %L, %L)', current_setting('t.r'),
  jsonb_build_array(pg_temp.line('t.r', 't.kopi', 1)), 'cash', '', '', 'Salah input'), 'direfund');
select public.owner_save_voucher(null, 'HEMAT', 'bill', 'amount', 2000, 0, null, (now() at time zone 'Asia/Jakarta')::date + 10, null);
select set_config('t.v', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.roti', 1)), 'voucher_code', 'HEMAT'), 'p-v')::text, false);
select pg_temp.fails('K11 voucher bill', format('select public.owner_correct_bill(%L, %L, %L, %L, %L, %L)', current_setting('t.v'),
  jsonb_build_array(pg_temp.line('t.v', 't.roti', 1)), 'cash', '', '', 'Salah input'), 'voucher');

-- ===== cash in and out (cash now 100.000 + 22.000 - 22.000 refund + 16.000 voucher bill = 116.000)
select pg_temp.ok('M0 cash before: 116.000', pg_temp.cash() = 116000);
select pg_temp.fails('M1 positive whole amount only', format('select public.owner_add_cash_movement(%L, %L, %s, %L)', current_setting('t.sh'), 'out', -5, 'Diambil'), 'Nominal');
select pg_temp.fails('M2 in or out only', format('select public.owner_add_cash_movement(%L, %L, %s, %L)', current_setting('t.sh'), 'keluar', 5000, 'Diambil'), 'masuk atau');
select public.owner_add_cash_movement(current_setting('t.sh')::uuid, 'out', 20000, 'Diambil pemilik untuk belanja');
select public.owner_add_cash_movement(current_setting('t.sh')::uuid, 'in', 5000, 'Uang kecil');
select pg_temp.ok('M3 cash 116.000 - 20.000 + 5.000 = 101.000', pg_temp.cash() = 101000);

-- ===== expenses: the cashier records 30.000 from the drawer; the owner cancels it and adds 50.000 paid outside
select set_config('t.ex', public.record_expense(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, 'drawer',
  jsonb_build_array(jsonb_build_object('name', 'Gula', 'category', 'belanja', 'quantity', 1, 'unit', 'kg', 'amount', 30000)), 'x-1')::text, false);
select pg_temp.ok('E1 cash 71.000 after the expense', pg_temp.cash() = 71000);
select pg_temp.fails('E2 cancel needs a reason', format('select public.owner_cancel_expense_item(%L, %L)', current_setting('t.ex')::jsonb -> 'items' -> 0 ->> 'id', 'x'), 'Alasan');
select set_config('t.ex', public.owner_cancel_expense_item((current_setting('t.ex')::jsonb -> 'items' -> 0 ->> 'id')::uuid, 'Belanja dobel dicatat')::text, false);
select pg_temp.ok('E3 cancelled: total 0, kept with its reason, cash back to 101.000',
  (current_setting('t.ex')::jsonb ->> 'total')::numeric = 0 and jsonb_array_length(current_setting('t.ex')::jsonb -> 'items') = 0
  and current_setting('t.ex')::jsonb -> 'cancelled' -> 0 ->> 'reason' = 'Belanja dobel dicatat' and pg_temp.cash() = 101000);
select pg_temp.fails('E4 cannot cancel twice', format('select public.owner_cancel_expense_item(%L, %L)', current_setting('t.ex')::jsonb -> 'cancelled' -> 0 ->> 'id', 'Lagi lagi'), 'sudah dibatalkan');
select set_config('t.ex', public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other',
  jsonb_build_array(jsonb_build_object('name', 'Listrik', 'category', 'operasional', 'quantity', 1, 'unit', 'pcs', 'amount', 50000)))::text, false);
select pg_temp.ok('E5 owner added 50.000 not from the drawer: total 50.000, cash unchanged',
  (current_setting('t.ex')::jsonb ->> 'total')::numeric = 50000 and pg_temp.cash() = 101000);

-- ===== the day
select pg_temp.ok('D1 the Tutup hari data: one open shift, its cash parts add up, checks clean',
  jsonb_array_length(pg_temp.day() -> 'shifts') = 1
  and (pg_temp.day() -> 'shifts' -> 0 ->> 'expected')::numeric = 101000
  and (pg_temp.day() -> 'shifts' -> 0 ->> 'opening')::numeric + (pg_temp.day() -> 'shifts' -> 0 ->> 'cashSales')::numeric
    - (pg_temp.day() -> 'shifts' -> 0 ->> 'cashRefunds')::numeric - (pg_temp.day() -> 'shifts' -> 0 ->> 'drawerExpenses')::numeric
    + (pg_temp.day() -> 'shifts' -> 0 ->> 'cashIn')::numeric - (pg_temp.day() -> 'shifts' -> 0 ->> 'cashOut')::numeric = 101000
  and (pg_temp.day() -> 'shifts' -> 0 ->> 'qrisSales')::numeric = 28800
  and jsonb_array_length(pg_temp.day() -> 'shifts' -> 0 -> 'movements') = 2
  and pg_temp.day() -> 'checks' = '[]'::jsonb);

-- Close, then correct and move cash on the closed shift: expected cash and variance follow, counted stays.
select public.close_shift(current_setting('t.sh')::uuid, 101000);
-- The QRIS bill was really paid in cash: the drawer should have held 28.800 more, so the count is 28.800 short.
select set_config('t.k2', public.owner_correct_bill(current_setting('t.n')::uuid,
  jsonb_build_array(pg_temp.line('t.n', 't.kopi', 1), pg_temp.line('t.n', 't.teh', 1)), 'cash', 'Bu Ani', 'A3', 'Dibayar tunai')::text, false);
select pg_temp.ok('C0 corrected on the closed shift: expected 129.800, counted 101.000, variance -28.800',
  (select expected_cash = 129800 and closing_cash = 101000 and variance = -28800 from public.shifts where id = current_setting('t.sh')::uuid)
  and (current_setting('t.k2')::jsonb ->> 'total')::numeric = 28800);
select public.owner_add_cash_movement(current_setting('t.sh')::uuid, 'out', 28800, 'Diambil pemilik sebelum dihitung');
select pg_temp.ok('C2 the owner had taken it: expected 101.000, variance 0',
  (select expected_cash = 101000 and variance = 0 from public.shifts where id = current_setting('t.sh')::uuid));
reset role;
select pg_temp.ok('C1 after closing nothing is out of balance',
  public.ledger_checks(current_setting('t.b')::uuid, current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day') = '[]'::jsonb);
set role authenticated;

-- ===== other owners
select set_config('request.jwt.claim.sub', 'e7300000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Lala', 'Satu', null);
select pg_temp.fails('X1 other owner cannot correct', format('select public.owner_correct_bill(%L, %L, %L, %L, %L, %L)', current_setting('t.n'),
  jsonb_build_array(pg_temp.line('t.n', 't.kopi', 1)), 'cash', '', '', 'Bukan punya'), 'tidak ditemukan');
select pg_temp.fails('X2 other owner cannot move cash', format('select public.owner_add_cash_movement(%L, %L, %s, %L)', current_setting('t.sh'), 'out', 1000, 'Bukan punya'), 'tidak ditemukan');
select pg_temp.fails('X3 other owner cannot read the day', format('select public.owner_day_close(%L, current_date)', current_setting('t.o')), 'tidak ditemukan');
reset role;
