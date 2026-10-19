-- Tests for 072 (ledger, bill discount per line, automatic checks) on top of 001 to the latest migration.
-- Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
create or replace function pg_temp.item(pid text, q int, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('product_id', current_setting(pid), 'quantity', q) || extra
$$;
create or replace function pg_temp.pay(payload jsonb, k text, method text default 'cash') returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    payload, method::public.payment_method, 1000000, null, k, null, null) ->> 'transactionId')::uuid
$$;
create or replace function pg_temp.checks() returns jsonb language sql as $$
  select public.ledger_checks(current_setting('t.b')::uuid, null, now() - interval '1 day', now() + interval '1 day')
$$;
create or replace function pg_temp.acct(a text) returns numeric language sql as $$
  select coalesce(sum(amount), 0) from public.ledger where business_id = current_setting('t.b')::uuid and account = a
$$;

select pg_temp.ok('S1 the ledger and the checks are internal', not has_table_privilege('authenticated', 'public.ledger', 'select')
  and not has_function_privilege('authenticated', 'public.ledger_checks(uuid, uuid, timestamptz, timestamptz)', 'execute'));

insert into auth.users(id, email) values ('e7200000-0000-0000-0000-000000000001', 'joni@kopi.id');
select set_config('request.jwt.claim.sub', 'e7200000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Joni', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Joni', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Joni'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select set_config('t.roti', public.create_product(current_setting('t.o')::uuid, null, 'Roti bakar', 6000, 18000, 100)::text, false);
select set_config('t.teh', public.create_product(current_setting('t.o')::uuid, null, 'Teh racik', 3000, 10000, 0, 'bar', false)::text, false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);

-- A: kopi + roti + teh = 50.000, bill discount Rp1.001: 440,44 / 360,36 / 200,2 -> 440 + 360 + 201 (the last line by id
-- takes what rounding leaves). Cash.
select set_config('t.a', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1), pg_temp.item('t.roti', 1), pg_temp.item('t.teh', 1)),
  'bill_discount_type', 'amount', 'bill_discount_value', 1001), 'p-a')::text, false);
select pg_temp.ok('D1 the shares add up to the bill discount exactly, none negative, total 48.999',
  (select sum(bill_discount_share) = 1001 and min(bill_discount_share) >= 0 from public.transaction_items where transaction_id = current_setting('t.a')::uuid)
  and (select total from public.transactions where id = current_setting('t.a')::uuid) = 48999);
select pg_temp.ok('D2 shares follow the line amounts (440 / 360 / 200-201)',
  (select array_agg(bill_discount_share order by selling_price_unit desc) from public.transaction_items where transaction_id = current_setting('t.a')::uuid)
  in (array[440, 360, 201]::numeric[], array[441, 360, 200]::numeric[], array[440, 361, 200]::numeric[]));

-- B: 2 kopi at 10% item discount, QRIS: 39.600. C: 1 roti cash 18.000, then refunded with restock.
select set_config('t.bb', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2, '{"discount_type": "percent", "discount_value": 10}'))), 'p-b', 'qris')::text, false);
select set_config('t.cc', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.roti', 1))), 'p-c')::text, false);
select public.refund_items_approved(current_setting('t.cc')::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting('t.cc')::uuid), 'quantity', 1, 'restock', true)),
  'cash', 'Roti gosong', '271828', 'r-1');
-- An expense from the drawer (belanja) and one from outside (operasional).
select public.record_expense(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, 'drawer',
  jsonb_build_array(jsonb_build_object('name', 'Gula', 'category', 'belanja', 'quantity', 1, 'unit', 'kg', 'amount', 15000)), 'k-1');
select public.record_expense(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, 'other',
  jsonb_build_array(jsonb_build_object('name', 'Listrik', 'category', 'operasional', 'quantity', 1, 'unit', 'pcs', 'amount', 50000)), 'k-2');

-- ===== per-product figures add up to the sales
select set_config('t.ps', public.owner_product_sales(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day')::text, false);
select pg_temp.ok('P1 products add up to the bills: 48.999 + 39.600 + 18.000 = 106.599',
  (select sum((v ->> 'sales')::numeric) from jsonb_each(current_setting('t.ps')::jsonb) as x(k, v)) = 106599);
select pg_temp.ok('P2 the report''s product total matches its sales before refunds',
  (public.owner_report(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day', now() - interval '3 days', now() - interval '1 day') -> 'productTotals' ->> 'sales')::numeric = 106599);

-- ===== the ledger
reset role;
select pg_temp.ok('L1 every document balances', not exists (
  select 1 from public.ledger where business_id = current_setting('t.b')::uuid group by doc_type, doc_id having sum(amount) <> 0));
select pg_temp.ok('L2 cash in the drawer: 100.000 + 48.999 + 18.000 - 18.000 refund - 15.000 = 133.999 (the cash book agrees)',
  (select coalesce(sum(amount), 0) from public.ledger where shift_id = current_setting('t.sh')::uuid and account = 'cash_drawer') = 133999
  and (select (public.get_shift_cash_summary(current_setting('t.sh')::uuid) ->> 'expected_cash')::numeric) = 133999);
select pg_temp.ok('L3 QRIS 39.600, net sales 106.599 - 18.000 = 88.599',
  pg_temp.acct('qris') = 39600 and -(pg_temp.acct('sales') + pg_temp.acct('discount') + pg_temp.acct('sales_return')) = 88599);
select pg_temp.ok('L4 stock: restocked roti back in inventory, cost of goods 8.000 + 6.000 + 3.000 + 16.000 + 6.000 - 6.000',
  pg_temp.acct('cogs') = 33000 and pg_temp.acct('cost_absorbed') = -3000 and pg_temp.acct('inventory') = -30000);
select pg_temp.ok('L5 expenses: belanja 15.000 as purchase, operasional 50.000, 50.000 paid outside the drawer',
  pg_temp.acct('purchase') = 15000 and pg_temp.acct('expense') = 50000);
select pg_temp.ok('C1 clean data passes every check', pg_temp.checks() = '[]'::jsonb);

-- ===== close the shift: the drawer goes to zero, the variance is booked
set role authenticated;
select public.close_shift(current_setting('t.sh')::uuid, 133000);
reset role;
select pg_temp.ok('C2 closed with 999 short: drawer at zero, variance -999 booked, checks still clean',
  (select coalesce(sum(amount), 0) from public.ledger where shift_id = current_setting('t.sh')::uuid and account = 'cash_drawer') = 0
  and pg_temp.acct('cash_variance') = 999 and pg_temp.checks() = '[]'::jsonb);

-- ===== the checks catch what went wrong
update public.transactions set total = total + 1 where id = current_setting('t.a')::uuid;
select pg_temp.ok('X1 a bill total changed behind the system''s back: P1 and P2 report that bill',
  exists (select 1 from jsonb_array_elements(pg_temp.checks()) f where f ->> 'rule' = 'P2' and f ->> 'ref' = current_setting('t.a'))
  and exists (select 1 from jsonb_array_elements(pg_temp.checks()) f where f ->> 'rule' = 'P1' and f ->> 'ref' = current_setting('t.a')));
update public.transactions set total = total - 1 where id = current_setting('t.a')::uuid;
update public.transaction_items set bill_discount_share = bill_discount_share + 1
  where id = (select id from public.transaction_items where transaction_id = current_setting('t.a')::uuid order by id limit 1);
select pg_temp.ok('X2 a share off by one rupiah: P2 reports it', exists (select 1 from jsonb_array_elements(pg_temp.checks()) f where f ->> 'rule' = 'P2'));
select public.allocate_bill_discount(current_setting('t.a')::uuid);
update public.shifts set expected_cash = expected_cash + 500 where id = current_setting('t.sh')::uuid;
select pg_temp.ok('X3 a closed shift whose expected cash was changed: P5 reports the shift',
  exists (select 1 from jsonb_array_elements(pg_temp.checks()) f where f ->> 'rule' = 'P5' and f ->> 'ref' = current_setting('t.sh')));
update public.shifts set expected_cash = expected_cash - 500 where id = current_setting('t.sh')::uuid;
select pg_temp.ok('X4 back to clean', pg_temp.checks() = '[]'::jsonb);

-- An open shift whose cash book got a row nobody booked: P5.
set role authenticated;
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
reset role;
insert into public.cash_ledger(shift_id, cashier_id, outlet_id, direction, amount, reason, source_type)
values (current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, 'in', 7000, 'tak dikenal', 'manual');
select pg_temp.ok('X5 an unexplained cash book row on an open shift: P5 reports it',
  exists (select 1 from jsonb_array_elements(pg_temp.checks()) f where f ->> 'rule' = 'P5' and f ->> 'ref' = current_setting('t.sh')));
delete from public.cash_ledger where source_type = 'manual' and shift_id = current_setting('t.sh')::uuid;
