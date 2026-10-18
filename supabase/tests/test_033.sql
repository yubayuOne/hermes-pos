-- Tests for 033 (item refunds) and 034 (backoffice refunds, restock fix, outlet logo) on top of 001 to 034.
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
create or replace function pg_temp.pay(payload jsonb, k text) returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    payload, 'cash', 1000000, null, k, null, null) ->> 'transactionId')::uuid
$$;
-- One refund line: the transaction_items row of product `pid` on bill `tx`.
create or replace function pg_temp.ri(tx text, pid text, q numeric, restock boolean default false) returns jsonb language sql as $$
  select jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting(tx)::uuid and product_id = current_setting(pid)::uuid),
    'quantity', q, 'restock', restock)
$$;
create or replace function pg_temp.refund(tx text, items jsonb, method text, k text, code text default '271828', reason text default 'menu salah') returns jsonb language sql as $$
  select public.refund_items_approved(current_setting(tx)::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
    items, method::public.payment_method, reason, code, k)
$$;
create or replace function pg_temp.cash() returns numeric language sql as $$
  select (public.get_shift_cash_summary(current_setting('t.sh')::uuid) ->> 'expected_cash')::numeric
$$;
create or replace function pg_temp.refunded(tx text) returns numeric language sql as $$
  select refunded_total from public.transactions where id = current_setting(tx)::uuid
$$;
create or replace function pg_temp.stock(pid text) returns numeric language sql as $$
  select stock from public.products where id = current_setting(pid)::uuid
$$;

insert into auth.users(id, email) values ('c0000000-0000-0000-0000-000000000001', 'rina@resto.id');
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Resto Rina', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Rina', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Rina'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select set_config('t.roti', public.create_product(current_setting('t.o')::uuid, null, 'Roti bakar', 6000, 18000, 100)::text, false);
select set_config('t.teh', public.create_product(current_setting('t.o')::uuid, null, 'Teh racik', 3000, 10000, 0, 'bar', false)::text, false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);
select public.owner_set_void_code('271828');

-- A: 2 kopi + 1 roti, bill discount 10%: 62.000 -> 55.800. B: 1 kopi 22.000. C: 1 teh (untracked) 10.000.
select set_config('t.a', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2), pg_temp.item('t.roti', 1)),
  'bill_discount_type', 'percent', 'bill_discount_value', 10), 'p-a')::text, false);
select set_config('t.bb', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'p-b')::text, false);
select set_config('t.cc', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.teh', 1))), 'p-c')::text, false);
select pg_temp.ok('S1 bill A total 55.800', (select total from public.transactions where id = current_setting('t.a')::uuid) = 55800);
select set_config('t.e0', pg_temp.cash()::text, false);

-- ===== partial cash refund
select set_config('t.r1', pg_temp.refund('t.a', jsonb_build_array(pg_temp.ri('t.a', 't.kopi', 1)), 'cash', 'r-1')::text, false);
select pg_temp.ok('R1 1 kopi gets its bill-discount share: 19.800', (current_setting('t.r1')::jsonb ->> 'amount')::numeric = 19800);
select pg_temp.ok('R2 refunded_total follows', pg_temp.refunded('t.a') = 19800);
select pg_temp.ok('R3 cash refund lowers expected cash', pg_temp.cash() = current_setting('t.e0')::numeric - 19800);
select pg_temp.ok('R4 no restock: kopi stock stays 97', pg_temp.stock('t.kopi') = 97);
select pg_temp.ok('R5 same key replays, nothing new', (pg_temp.refund('t.a', jsonb_build_array(pg_temp.ri('t.a', 't.kopi', 1)), 'cash', 'r-1') ->> 'replayed')::boolean
  and pg_temp.refunded('t.a') = 19800 and pg_temp.cash() = current_setting('t.e0')::numeric - 19800);
select pg_temp.fails('R6 same key on another bill', $q$select pg_temp.refund('t.bb', jsonb_build_array(pg_temp.ri('t.bb', 't.kopi', 1)), 'cash', 'r-1')$q$, 'bill lain');
select pg_temp.fails('R7 more than left', $q$select pg_temp.refund('t.a', jsonb_build_array(pg_temp.ri('t.a', 't.kopi', 2)), 'cash', 'r-x1')$q$, 'melebihi');
select pg_temp.ok('R8 wrong code counts down', (pg_temp.refund('t.a', jsonb_build_array(pg_temp.ri('t.a', 't.roti', 1)), 'cash', 'r-x2', '000000') ->> 'attempts_left')::int = 4);
select pg_temp.ok('R9 wrong code refunds nothing', pg_temp.refunded('t.a') = 19800);
select pg_temp.fails('R10 reason required', $q$select pg_temp.refund('t.a', jsonb_build_array(pg_temp.ri('t.a', 't.roti', 1)), 'cash', 'r-x3', '271828', 'x')$q$, 'Alasan');
select pg_temp.fails('R11 item of another bill', $q$select pg_temp.refund('t.a', jsonb_build_array(pg_temp.ri('t.bb', 't.kopi', 1)), 'cash', 'r-x4')$q$, 'Item tidak ada');
select pg_temp.fails('R12 empty item list', $q$select pg_temp.refund('t.a', '[]'::jsonb, 'cash', 'r-x5')$q$, 'Pilih item');
select pg_temp.fails('R13 void after refund refused', format('select public.void_transaction_approved(%L, %L, %L)', current_setting('t.a'), 'salah input', '271828'), 'sudah direfund');

-- ===== final QRIS refund with restock
select set_config('t.r2', pg_temp.refund('t.a', jsonb_build_array(pg_temp.ri('t.a', 't.kopi', 1), pg_temp.ri('t.a', 't.roti', 1, true)), 'qris', 'r-2')::text, false);
select pg_temp.ok('R14 last refund takes exactly what is left: 36.000', (current_setting('t.r2')::jsonb ->> 'amount')::numeric = 36000
  and (current_setting('t.r2')::jsonb ->> 'fullyRefunded')::boolean);
select pg_temp.ok('R15 refunds add up to the bill total', pg_temp.refunded('t.a') = 55800);
select pg_temp.ok('R16 QRIS refund leaves the drawer alone', pg_temp.cash() = current_setting('t.e0')::numeric - 19800);
select pg_temp.ok('R17 restocked roti is back: 100', pg_temp.stock('t.roti') = 100);
select pg_temp.fails('R18 nothing left to refund', $q$select pg_temp.refund('t.a', jsonb_build_array(pg_temp.ri('t.a', 't.roti', 1)), 'cash', 'r-x6')$q$, 'melebihi');

-- ===== untracked product: restock asked, nothing happens
select pg_temp.ok('R19 untracked teh refunded in full', (pg_temp.refund('t.cc', jsonb_build_array(pg_temp.ri('t.cc', 't.teh', 1, true)), 'cash', 'r-4') ->> 'amount')::numeric = 10000);
select pg_temp.ok('R20 untracked stock unchanged', pg_temp.stock('t.teh') = 0);

-- ===== reports in the POS
select pg_temp.ok('R21 shift report: 3 refunds, 65.800, revenue net 22.000', (select (r ->> 'refundCount')::int = 3 and (r ->> 'refundTotal')::numeric = 65800
  and (r ->> 'totalRevenue')::numeric = 22000 and (r ->> 'refundQris')::numeric = 36000 from (select public.get_shift_report(current_setting('t.sh')::uuid) r) x));
select pg_temp.ok('R22 bill list carries refundedTotal', (select (x ->> 'refundedTotal')::numeric = 55800 from jsonb_array_elements(public.list_shift_bills(current_setting('t.sh')::uuid, 'completed') -> 'rows') x
  where x ->> 'id' = current_setting('t.a')));
select pg_temp.ok('R23 bill items carry itemId and refundedQty', (select sum((x ->> 'refundedQty')::numeric) = 3 and bool_and(x ? 'itemId') from jsonb_array_elements(public.get_bill_items(current_setting('t.a')::uuid)) x));
select pg_temp.ok('R24 dashboard sales net 22.000', (select (d ->> 'sales')::numeric = 22000 and (d ->> 'refundTotal')::numeric = 65800 from (select public.get_dashboard_summary(current_setting('t.c')::uuid, current_setting('t.o')::uuid,
  now() - interval '1 day', now() + interval '1 day', now() - interval '3 days', now() - interval '2 days') d) x));
select pg_temp.ok('R25 owner notified once per refund', (select count(*) = 3 from jsonb_array_elements(public.list_notifications()) n where n ->> 'kind' = 'refund'));
select pg_temp.fails('R26 refund tables not readable', $q$select * from public.transaction_refunds$q$, 'permission denied');
select pg_temp.fails('R27 code check not callable', $q$select public.check_void_code(gen_random_uuid(), '271828')$q$, 'permission denied');

-- ===== 24 hours
reset role;
update public.transactions set created_at = now() - interval '25 hours' where id = current_setting('t.bb')::uuid;
set role authenticated;
select pg_temp.fails('R28 older than 24 hours', $q$select pg_temp.refund('t.bb', jsonb_build_array(pg_temp.ri('t.bb', 't.kopi', 1)), 'cash', 'r-x7')$q$, '24 jam');
reset role;
update public.transactions set created_at = now() where id = current_setting('t.bb')::uuid;
set role authenticated;

-- ===== bill of a closed shift lands in the new shift
select public.close_shift(current_setting('t.sh')::uuid, 0);
select set_config('t.sh_old', current_setting('t.sh'), false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 50000)::text, false);
select set_config('t.dd', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'p-d')::text, false);
select pg_temp.ok('R29 closed-shift bill refunded', (pg_temp.refund('t.bb', jsonb_build_array(pg_temp.ri('t.bb', 't.kopi', 1)), 'cash', 'r-5') ->> 'amount')::numeric = 22000);
select pg_temp.ok('R30 cash leaves the new shift', (public.get_shift_cash_summary(current_setting('t.sh')::uuid) ->> 'cash_out')::numeric = 22000);
select pg_temp.fails('R31 refund into a closed shift refused', format('select public.refund_items_approved(%L, %L, %L, %L::jsonb, %L, %L, %L, %L)',
  current_setting('t.dd'), current_setting('t.sh_old'), current_setting('t.c'), jsonb_build_array(pg_temp.ri('t.dd', 't.kopi', 1)), 'cash', 'menu salah', '271828', 'r-x8'), 'Shift aktif');

-- ===== expired subscription
reset role;
update public.subscriptions set expires_at = now() - interval '1 hour' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select pg_temp.fails('R32 expired: refund refused', $q$select pg_temp.refund('t.dd', jsonb_build_array(pg_temp.ri('t.dd', 't.kopi', 1)), 'cash', 'r-x9')$q$, 'Langganan berakhir');
select pg_temp.fails('R33 expired: logo refused', format('select public.owner_set_outlet_logo(%L, %L)', current_setting('t.o'), 'https://cdn.example.com/a.png'), 'Langganan berakhir');
reset role;
update public.subscriptions set expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
-- 034: restock kept only where stock really moved (teh is untracked)
select pg_temp.ok('O0 untracked restock stored as false', (select bool_and(not ri.restock) from public.transaction_refund_items ri join public.transaction_items ti on ti.id = ri.transaction_item_id
  where ti.product_id = current_setting('t.teh')::uuid));
set role authenticated;

-- ===== 034: backoffice
-- Sales A 55.800 + B 22.000 + C 10.000 + D 22.000 = 109.800; refunds 19.800 + 36.000 + 10.000 + 22.000 = 87.800.
-- HPP 22.000 + 8.000 + 3.000 + 8.000 = 41.000; restocked roti 6.000 comes out. Profit = 22.000 - 35.000 = -13.000.
select set_config('t.sum', public.owner_sales_summary(null, now() - interval '1 day', now() + interval '1 day', now() - interval '3 days', now() - interval '2 days')::text, false);
select pg_temp.ok('O1 sales net 22.000, 4 refunds 87.800', (current_setting('t.sum')::jsonb ->> 'sales')::numeric = 22000
  and (current_setting('t.sum')::jsonb ->> 'refundCount')::int = 4 and (current_setting('t.sum')::jsonb ->> 'refundTotal')::numeric = 87800);
select pg_temp.ok('O2 profit takes restocked cost out only', (current_setting('t.sum')::jsonb ->> 'profit')::numeric = -13000);
select pg_temp.ok('O3 cash and QRIS split by refund method', (current_setting('t.sum')::jsonb ->> 'cash')::numeric = 58000 and (current_setting('t.sum')::jsonb ->> 'qris')::numeric = -36000);
select pg_temp.ok('O4 daily total and bill count', (select sum((d ->> 'total')::numeric) = 22000 and sum((d ->> 'count')::int) = 4 from jsonb_array_elements(current_setting('t.sum')::jsonb -> 'daily') d));
select pg_temp.ok('O5 per outlet and per cashier net', (current_setting('t.sum')::jsonb -> 'byOutlet' -> 0 ->> 'sales')::numeric = 22000
  and (current_setting('t.sum')::jsonb -> 'byCashier' -> 0 ->> 'sales')::numeric = 22000);
select pg_temp.ok('O6 owner bill list carries refundedTotal', (select (x ->> 'refundedTotal')::numeric = 55800 from jsonb_array_elements(public.owner_list_bills(null, now() - interval '1 day', now() + interval '1 day') -> 'rows') x
  where x ->> 'id' = current_setting('t.a')));
select pg_temp.ok('O7 owner bill items carry refundedQty', (select sum((x ->> 'refundedQty')::numeric) = 3 from jsonb_array_elements(public.owner_get_bill_items(current_setting('t.a')::uuid)) x));
select pg_temp.ok('O8 refunds of a bill, oldest first', (select jsonb_array_length(r) = 2 and r -> 1 ->> 'method' = 'qris' and (r -> 1 ->> 'amount')::numeric = 36000
  and jsonb_array_length(r -> 1 -> 'items') = 2 and r -> 0 ->> 'cashierName' = 'Rina' from (select public.owner_list_bill_refunds(current_setting('t.a')::uuid) r) x));
select pg_temp.fails('O9 refunds of an unknown bill', format('select public.owner_list_bill_refunds(%L)', gen_random_uuid()), 'tidak ditemukan');

-- ===== 034: outlet logo
select public.owner_set_outlet_logo(current_setting('t.o')::uuid, ' https://cdn.example.com/logo.png ');
select pg_temp.ok('L1 logo saved, trimmed', (select logo_url from public.outlets where id = current_setting('t.o')::uuid) = 'https://cdn.example.com/logo.png');
select pg_temp.ok('L2 POS cashier list shows it', (select outlet_logo_url from public.list_device_cashiers() where cashier_name = 'Rina') = 'https://cdn.example.com/logo.png');
select pg_temp.fails('L3 http refused', format('select public.owner_set_outlet_logo(%L, %L)', current_setting('t.o'), 'http://cdn.example.com/a.png'), 'https');
select pg_temp.fails('L4 other scheme refused', format('select public.owner_set_outlet_logo(%L, %L)', current_setting('t.o'), 'javascript:alert(1)'), 'https');
select pg_temp.fails('L5 unknown outlet', format('select public.owner_set_outlet_logo(%L, %L)', gen_random_uuid(), 'https://cdn.example.com/a.png'), 'tidak ditemukan');
select public.owner_set_outlet_logo(current_setting('t.o')::uuid, '');
select pg_temp.ok('L6 empty clears the logo', (select logo_url is null from public.outlets where id = current_setting('t.o')::uuid));
reset role;
