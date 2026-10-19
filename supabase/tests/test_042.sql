-- Tests for 042 (owner report) on top of 001 to 042. Every line of output must start with PASS.
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
create or replace function pg_temp.pay(payload jsonb, k text) returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    payload, 'cash', 1000000, null, k, null, null) ->> 'transactionId')::uuid
$$;
create or replace function pg_temp.it(name text, category text, amount int) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'category', category, 'quantity', 1, 'unit', 'pcs', 'amount', amount)
$$;
create or replace function pg_temp.rep(outlet uuid default null) returns jsonb language sql as $$
  select public.owner_report(outlet, now() - interval '1 day', now() + interval '1 day', now() - interval '3 days', now() - interval '1 day')
$$;

insert into auth.users(id, email) values ('e0000000-0000-0000-0000-000000000001', 'rina@resto.id'), ('e0000000-0000-0000-0000-000000000002', 'budi@lain.id');
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Resto Rina', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Rina', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Rina'), false);
select set_config('t.minum', public.create_category(current_setting('t.o')::uuid, 'Minuman')::text, false);
select set_config('t.makan', public.create_category(current_setting('t.o')::uuid, 'Makanan')::text, false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, current_setting('t.minum')::uuid, 'Kopi susu', 8000, 22000, 100)::text, false);
select set_config('t.roti', public.create_product(current_setting('t.o')::uuid, current_setting('t.makan')::uuid, 'Roti bakar', 6000, 18000, 100)::text, false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);

-- A: 2 kopi + 1 roti = 62.000. B: 1 kopi = 22.000, refunded in cash with restock. HPP 30.000, restocked 8.000.
select pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2), pg_temp.item('t.roti', 1))), 'p-a');
select set_config('t.bb', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'p-b')::text, false);
select public.refund_items_approved(current_setting('t.bb')::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting('t.bb')::uuid), 'quantity', 1, 'restock', true)),
  'cash', 'salah pesan', '271828', 'r-1');
-- C: 1 roti 18.000 with a 10% bill discount (16.200), then voided: counts in voids, not in sales or discounts.
select set_config('t.cv', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.roti', 1)),
  'bill_discount_type', 'percent', 'bill_discount_value', 10), 'p-c')::text, false);
select public.void_transaction_approved(current_setting('t.cv')::uuid, 'salah input', '271828');
-- D: 1 kopi with a 10% bill discount: 22.000 -> 19.800, manual discount 2.200.
select pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1)), 'bill_discount_type', 'percent', 'bill_discount_value', 10), 'p-d');
-- Expenses: gula 36.000 from the drawer, listrik 50.000 not from the drawer.
select public.record_expense(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, 'drawer', jsonb_build_array(pg_temp.it('Gula pasir', 'belanja', 36000)), 'x-1');
select set_config('t.ex', (public.record_expense(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, 'other', jsonb_build_array(pg_temp.it('Listrik', 'operasional', 50000)), 'x-2') ->> 'id'), false);
-- Expected 100.000 + 84.000 + 19.800 - 22.000 - 36.000 = 145.800; counted 139.800.
select pg_temp.ok('S1 shift closes 6.000 short', (public.close_shift(current_setting('t.sh')::uuid, 139800) ->> 'variance')::numeric = -6000);

select set_config('t.r', pg_temp.rep()::text, false);
select pg_temp.ok('P1 expenses count at once (043): operating 50.000',
  (current_setting('t.r')::jsonb -> 'pnl' ->> 'operatingExpenses')::numeric = 50000
  and current_setting('t.r')::jsonb -> 'expenses' -> 'pendingCount' is null);

-- One transaction gives both shifts the same now(); the first opened an hour earlier.
reset role;
update public.shifts set opened_at = opened_at - interval '1 hour' where id = current_setting('t.sh')::uuid;
set role authenticated;
-- Second shift, still open, with an expense that counts at once.
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
select public.record_expense(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, 'other', jsonb_build_array(pg_temp.it('Sabun', 'operasional', 10000)), 'x-3');

select set_config('t.r', pg_temp.rep()::text, false);
select pg_temp.ok('P2 gross 106.000 - discount 2.200 - refund 22.000 = net 81.800; HPP 30.000; gross profit 51.800',
  (current_setting('t.r')::jsonb -> 'pnl' ->> 'grossSales')::numeric = 106000 and (current_setting('t.r')::jsonb -> 'pnl' ->> 'discounts')::numeric = 2200
  and (current_setting('t.r')::jsonb -> 'pnl' ->> 'refunds')::numeric = 22000 and (current_setting('t.r')::jsonb -> 'pnl' ->> 'netSales')::numeric = 81800
  and (current_setting('t.r')::jsonb -> 'pnl' ->> 'hpp')::numeric = 30000 and (current_setting('t.r')::jsonb -> 'pnl' ->> 'grossProfit')::numeric = 51800
  and (current_setting('t.r')::jsonb -> 'pnl' ->> 'count')::int = 3);
select pg_temp.ok('P3 only operasional is an operating expense: 50.000 + 10.000; belanja 36.000 apart; the drawer 6.000 short (075): operating profit -14.200',
  (current_setting('t.r')::jsonb -> 'pnl' ->> 'operatingExpenses')::numeric = 60000 and (current_setting('t.r')::jsonb -> 'pnl' ->> 'inventoryPurchases')::numeric = 36000
  and (current_setting('t.r')::jsonb -> 'pnl' ->> 'cashDifference')::numeric = -6000
  and (current_setting('t.r')::jsonb -> 'pnl' ->> 'operatingProfit')::numeric = -14200);
select pg_temp.ok('D1 drawer of closed shifts: 100.000 + 103.800 - 22.000 - 36.000 = 145.800, counted 139.800',
  (current_setting('t.r')::jsonb -> 'drawer' ->> 'opening')::numeric = 100000 and (current_setting('t.r')::jsonb -> 'drawer' ->> 'cashSales')::numeric = 103800
  and (current_setting('t.r')::jsonb -> 'drawer' ->> 'refunds')::numeric = 22000 and (current_setting('t.r')::jsonb -> 'drawer' ->> 'expenses')::numeric = 36000
  and (current_setting('t.r')::jsonb -> 'drawer' ->> 'other')::numeric = 0
  and (current_setting('t.r')::jsonb -> 'drawer' ->> 'expected')::numeric = 145800 and (current_setting('t.r')::jsonb -> 'drawer' ->> 'counted')::numeric = 139800);
select pg_temp.ok('V2 voids by cashier: Rina 1 bill 16.200; manual discount 1 bill 2.200',
  current_setting('t.r')::jsonb -> 'voidsByCashier' -> 0 ->> 'name' = 'Rina' and (current_setting('t.r')::jsonb -> 'voidsByCashier' -> 0 ->> 'total')::numeric = 16200
  and current_setting('t.r')::jsonb -> 'discounts' -> 0 ->> 'voucher' is null and (current_setting('t.r')::jsonb -> 'discounts' -> 0 ->> 'amount')::numeric = 2200
  and (current_setting('t.r')::jsonb -> 'discounts' -> 0 ->> 'count')::int = 1
  and current_setting('t.r')::jsonb -> 'cashierOutlets' ->> current_setting('t.c') = 'Pusat');
select pg_temp.ok('P4 previous period is empty', (current_setting('t.r')::jsonb -> 'previousPnl' ->> 'netSales')::numeric = 0
  and (current_setting('t.r')::jsonb -> 'previousPnl' ->> 'count')::int = 0);
select pg_temp.ok('C1 cash: 1 closed, 1 open, 6.000 short',
  (current_setting('t.r')::jsonb -> 'cash' ->> 'closed')::int = 1 and (current_setting('t.r')::jsonb -> 'cash' ->> 'open')::int = 1
  and (current_setting('t.r')::jsonb -> 'cash' ->> 'variance')::numeric = -6000 and (current_setting('t.r')::jsonb -> 'cash' ->> 'shortCount')::int = 1);
select pg_temp.ok('C2 shift rows in order with expected and counted cash',
  jsonb_array_length(current_setting('t.r')::jsonb -> 'shifts') = 2
  and (current_setting('t.r')::jsonb -> 'shifts' -> 0 ->> 'expectedCash')::numeric = 145800
  and (current_setting('t.r')::jsonb -> 'shifts' -> 0 ->> 'closingCash')::numeric = 139800
  and (current_setting('t.r')::jsonb -> 'shifts' -> 1 ->> 'open')::boolean
  and current_setting('t.r')::jsonb -> 'shifts' -> 0 ->> 'cashierName' = 'Rina');
select pg_temp.ok('E1 expenses incl. the open shift: belanja 36.000, operasional 60.000, drawer 36.000',
  (current_setting('t.r')::jsonb -> 'expenses' ->> 'total')::numeric = 96000 and (current_setting('t.r')::jsonb -> 'expenses' ->> 'belanja')::numeric = 36000
  and (current_setting('t.r')::jsonb -> 'expenses' ->> 'operasional')::numeric = 60000 and (current_setting('t.r')::jsonb -> 'expenses' ->> 'drawer')::numeric = 36000);
select pg_temp.ok('E2 largest expense first, one day', current_setting('t.r')::jsonb -> 'expenses' -> 'top' -> 0 ->> 'name' = 'Listrik'
  and jsonb_array_length(current_setting('t.r')::jsonb -> 'expenses' -> 'daily') = 1);
-- Since 072 a line's sales are net of its share of the bill discount: D's 2.200 comes off the kopi.
select pg_temp.ok('K1 by category before refunds, voided bill left out: Minuman 85.800 (4), Makanan 18.000',
  current_setting('t.r')::jsonb -> 'byCategory' -> 0 ->> 'name' = 'Minuman' and (current_setting('t.r')::jsonb -> 'byCategory' -> 0 ->> 'sales')::numeric = 85800
  and (current_setting('t.r')::jsonb -> 'byCategory' -> 0 ->> 'qty')::numeric = 4 and (current_setting('t.r')::jsonb -> 'byCategory' -> 1 ->> 'sales')::numeric = 18000);
select pg_temp.ok('K2 products: kopi profit 53.800, 2 products, totals 103.800 (= gross 106.000 - discount 2.200)',
  current_setting('t.r')::jsonb -> 'products' -> 0 ->> 'name' = 'Kopi susu' and (current_setting('t.r')::jsonb -> 'products' -> 0 ->> 'profit')::numeric = 53800
  and (current_setting('t.r')::jsonb ->> 'productCount')::int = 2 and (current_setting('t.r')::jsonb -> 'productTotals' ->> 'sales')::numeric = 103800
  and current_setting('t.r')::jsonb -> 'outlets' ->> 0 = 'Pusat');
select pg_temp.ok('K3 outlet filter gives the same numbers', (pg_temp.rep(current_setting('t.o')::uuid) -> 'pnl' ->> 'netSales')::numeric = 81800);
select pg_temp.fails('V1 reversed range', 'select public.owner_report(null, now(), now() - interval ''1 day'', now() - interval ''2 days'', now() - interval ''1 day'')', 'tidak valid');

-- Expired subscription: still readable.
reset role;
update public.subscriptions set expires_at = now() - interval '1 day' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select pg_temp.ok('L1 expired: report still readable', (pg_temp.rep() -> 'pnl' ->> 'netSales')::numeric = 81800);

-- Another business sees nothing and cannot ask for this outlet.
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Budi', 'Satu', null);
select pg_temp.ok('X1 other owner: empty report', (pg_temp.rep() -> 'pnl' ->> 'netSales')::numeric = 0
  and jsonb_array_length(pg_temp.rep() -> 'shifts') = 0 and jsonb_array_length(pg_temp.rep() -> 'products') = 0);
select pg_temp.fails('X2 other owner cannot read this outlet', format('select pg_temp.rep(%L::uuid)', current_setting('t.o')), 'tidak ditemukan');
select pg_temp.fails('X3 helper is not callable', format('select public.report_pnl(%L::uuid, null, now(), now())', current_setting('t.b')), 'permission denied');
reset role;
