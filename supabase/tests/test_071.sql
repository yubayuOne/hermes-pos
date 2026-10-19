-- Tests for 071 (balancing per shift) on top of 001 to the latest migration.
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
create or replace function pg_temp.adj(kind text, amount numeric, category text default null, reason text default 'Selisih hitung') returns jsonb language sql as $$
  select public.owner_add_shift_adjustment(current_setting('t.sh')::uuid, kind, amount, category, reason)
$$;
create or replace function pg_temp.shift() returns public.shifts language sql as $$
  select * from public.shifts where id = current_setting('t.sh')::uuid
$$;
create or replace function pg_temp.summary() returns jsonb language sql as $$
  select public.owner_sales_summary(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day', now() - interval '3 days', now() - interval '1 day')
$$;
create or replace function pg_temp.pnl() returns jsonb language sql as $$
  select public.owner_report_page(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day', now() - interval '3 days', now() - interval '1 day') -> 'pnl'
$$;
create or replace function pg_temp.balances() returns jsonb language sql as $$
  select public.owner_list_shift_balances(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day', 1)
$$;

select pg_temp.ok('S1 adjustments are read and written only through the functions',
  not has_table_privilege('authenticated', 'public.shift_adjustments', 'select') and not has_table_privilege('authenticated', 'public.shift_adjustments', 'insert'));
select pg_temp.ok('S2 owners can call them, anon cannot',
  has_function_privilege('authenticated', 'public.owner_add_shift_adjustment(uuid, text, numeric, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.owner_add_shift_adjustment(uuid, text, numeric, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_list_shift_balances(uuid, timestamptz, timestamptz, integer)', 'execute')
  and not has_function_privilege('anon', 'public.owner_list_shift_balances(uuid, timestamptz, timestamptz, integer)', 'execute'));
select pg_temp.ok('S3 the old expense edit is gone', to_regprocedure('public.owner_update_expense(uuid, jsonb)') is null);

insert into auth.users(id, email) values ('e7100000-0000-0000-0000-000000000001', 'hana@kopi.id'), ('e7100000-0000-0000-0000-000000000002', 'iwan@lain.id');
select set_config('request.jwt.claim.sub', 'e7100000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Hana', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Hana', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Hana'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);

-- 2 kopi cash 44.000 (hpp 16.000), gula 30.000 from the drawer (belanja). Counted 114.000 at close: variance 0.
select public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
  jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', current_setting('t.kopi'), 'quantity', 2))), 'cash', 50000, null, 'p-1', null, null);
select public.record_expense(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, 'drawer',
  jsonb_build_array(jsonb_build_object('name', 'Gula', 'category', 'belanja', 'quantity', 1, 'unit', 'kg', 'amount', 30000, 'paidFrom', 'drawer')), 'k-1');
select public.close_shift(current_setting('t.sh')::uuid, 114000);
select pg_temp.ok('B1 closed: expected 114.000, variance 0', (pg_temp.shift()).expected_cash = 114000 and (pg_temp.shift()).variance = 0);

-- ===== validation
select pg_temp.fails('V1 unknown kind', $q$select pg_temp.adj('stock', 1000)$q$, 'Jenis penyesuaian');
select pg_temp.fails('V2 zero', $q$select pg_temp.adj('cash', 0)$q$, 'tidak nol');
select pg_temp.fails('V3 cents', $q$select pg_temp.adj('cash', 1000.5)$q$, 'angka bulat');
select pg_temp.fails('V4 an expense needs a category', $q$select pg_temp.adj('expense', 1000)$q$, 'kategori');
select pg_temp.fails('V5 only an expense has a category', $q$select pg_temp.adj('cash', 1000, 'belanja')$q$, 'kategori');
select pg_temp.fails('V6 reason required', $q$select pg_temp.adj('cash', 1000, null, ' x ')$q$, 'Alasan');
select pg_temp.fails('V7 too large', $q$select pg_temp.adj('sales', 2000000000)$q$, 'maksimal');
reset role;
select pg_temp.ok('V8 refused lines left nothing', (select count(*) from public.shift_adjustments where shift_id = current_setting('t.sh')::uuid) = 0);
set role authenticated;

-- ===== cash: 10.000 taken out of the drawer after closing
select pg_temp.adj('cash', -10000, null, 'Diambil untuk kembalian besok');
select pg_temp.ok('C1 expected cash 104.000, counted 114.000 stays, variance +10.000',
  (pg_temp.shift()).expected_cash = 104000 and (pg_temp.shift()).closing_cash = 114000 and (pg_temp.shift()).variance = 10000);
reset role;
select pg_temp.ok('C2 one cash book row, out 10.000, marked adjustment',
  (select count(*) = 1 and min(direction) = 'out' and min(amount) = 10000 from public.cash_ledger where shift_id = current_setting('t.sh')::uuid and source_type = 'adjustment'));
set role authenticated;

-- ===== sales: +5.000 (a price typed too low)
select pg_temp.adj('sales', 5000, null, 'Harga kopi salah input');
select pg_temp.ok('A1 net sales 49.000, profit 33.000, adjustment 5.000; cash and bill count unchanged',
  (pg_temp.summary() ->> 'sales')::numeric = 49000 and (pg_temp.summary() ->> 'profit')::numeric = 33000
  and (pg_temp.summary() ->> 'adjustmentTotal')::numeric = 5000 and (pg_temp.summary() ->> 'cash')::numeric = 44000
  and (pg_temp.summary() ->> 'count')::int = 1);
select pg_temp.ok('A2 the day and the cashier carry it too',
  (pg_temp.summary() -> 'daily' -> 0 ->> 'total')::numeric = 49000 and (pg_temp.summary() -> 'byCashier' -> 0 ->> 'sales')::numeric = 49000);
select pg_temp.ok('A3 P&L: net sales 49.000 with adjustments 5.000', (pg_temp.pnl() ->> 'netSales')::numeric = 49000
  and (pg_temp.pnl() ->> 'adjustments')::numeric = 5000 and (pg_temp.pnl() ->> 'grossProfit')::numeric = 33000);
select pg_temp.ok('A4 expected cash not touched by a sales correction', (pg_temp.shift()).expected_cash = 104000);

-- ===== expense: -5.000 belanja (the receipt said 25.000)
select pg_temp.adj('expense', -5000, 'belanja', 'Nota gula 25.000');
select pg_temp.ok('E1 expense totals 25.000, of which -5.000 adjustment',
  (public.owner_list_expenses(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day') -> 'totals' ->> 'total')::numeric = 25000
  and (public.owner_list_expenses(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day') -> 'totals' ->> 'belanja')::numeric = 25000
  and (public.owner_list_expenses(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day') -> 'totals' ->> 'adjustments')::numeric = -5000);
select pg_temp.ok('E2 P&L ingredient purchases 25.000, operating profit unchanged by belanja',
  (pg_temp.pnl() ->> 'inventoryPurchases')::numeric = 25000 and (pg_temp.pnl() ->> 'operatingProfit')::numeric = 33000);
select pg_temp.ok('E3 report page: sales 49.000, expenses 25.000',
  (public.owner_report_page(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day', now() - interval '3 days', now() - interval '1 day') -> 'sales' ->> 'sales')::numeric = 49000
  and (public.owner_report_page(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day', now() - interval '3 days', now() - interval '1 day') -> 'expenses' ->> 'total')::numeric = 25000);
select pg_temp.ok('E4 dashboard: sales after expenses 49.000 - 25.000 = 24.000',
  (public.owner_dashboard(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day', now() - interval '3 days', now() - interval '1 day',
    now() - interval '6 days', now() - interval '1 hour', now() + interval '1 hour') -> 'period' ->> 'salesAfterExpenses')::numeric = 24000);

-- ===== the Balancing page
select pg_temp.ok('L1 one shift: sales 49.000, expenses 25.000, expected 104.000, counted 114.000, +10.000, three lines oldest first',
  (pg_temp.balances() ->> 'total')::int = 1
  and (pg_temp.balances() -> 'rows' -> 0 ->> 'sales')::numeric = 49000 and (pg_temp.balances() -> 'rows' -> 0 ->> 'expenses')::numeric = 25000
  and (pg_temp.balances() -> 'rows' -> 0 ->> 'expectedCash')::numeric = 104000 and (pg_temp.balances() -> 'rows' -> 0 ->> 'closingCash')::numeric = 114000
  and (pg_temp.balances() -> 'rows' -> 0 ->> 'variance')::numeric = 10000
  and jsonb_array_length(pg_temp.balances() -> 'rows' -> 0 -> 'adjustments') = 3
  and pg_temp.balances() -> 'rows' -> 0 -> 'adjustments' -> 0 ->> 'kind' = 'cash'
  and pg_temp.balances() -> 'rows' -> 0 ->> 'cashierName' = 'Hana');

-- An open shift: cash in counts in its expected cash at once, for the cashier too.
reset role;
update public.shifts set opened_at = opened_at - interval '1 hour' where id = current_setting('t.sh')::uuid;
set role authenticated;
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 50000)::text, false);
select pg_temp.adj('cash', 20000, null, 'Tambah uang kecil');
select pg_temp.ok('O1 open shift: expected 70.000 on the page and in the cashier''s cash summary',
  (pg_temp.balances() -> 'rows' -> 0 ->> 'open')::boolean and (pg_temp.balances() -> 'rows' -> 0 ->> 'expectedCash')::numeric = 70000
  and (public.get_shift_cash_summary(current_setting('t.sh')::uuid) ->> 'expected_cash')::numeric = 70000);

-- ===== other owners and expired plans
select set_config('request.jwt.claim.sub', 'e7100000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Iwan', 'Satu', null);
select pg_temp.fails('X1 other owner cannot add', $q$select pg_temp.adj('cash', 1000)$q$, 'tidak ditemukan');
select pg_temp.fails('X2 other owner cannot list', $q$select pg_temp.balances()$q$, 'tidak ditemukan');
select set_config('request.jwt.claim.sub', 'e7100000-0000-0000-0000-000000000001', false);
reset role;
update public.subscriptions set expires_at = now() - interval '1 day' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select pg_temp.fails('X3 expired plan cannot add', $q$select pg_temp.adj('cash', 1000)$q$, 'Langganan berakhir');
reset role;
