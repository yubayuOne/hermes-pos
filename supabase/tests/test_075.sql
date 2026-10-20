-- Tests for 075 (QRIS count at shift close, P&L differences) and 078 (no day close, no day lock).
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
create or replace function pg_temp.pay(pid text, k text, method text) returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', current_setting(pid), 'quantity', 1))),
    method::public.payment_method, 1000000, null, k, null, null) ->> 'transactionId')::uuid
$$;
create or replace function pg_temp.day() returns jsonb language sql as $$
  select public.owner_day_close(current_setting('t.o')::uuid, current_setting('t.d')::date)
$$;

select pg_temp.ok('S1 closing and reopening a day are gone for everyone (078); the lock table is closed to clients',
  not has_function_privilege('authenticated', 'public.owner_close_day(uuid, date, numeric, text)', 'execute')
  and not has_function_privilege('anon', 'public.owner_close_day(uuid, date, numeric, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.owner_reopen_day(uuid, date, text)', 'execute')
  and not has_function_privilege('anon', 'public.owner_reopen_day(uuid, date, text)', 'execute')
  and has_function_privilege('authenticated', 'public.close_shift_at(uuid, numeric, timestamptz, numeric)', 'execute')
  and to_regprocedure('public.close_shift_at(uuid, numeric, timestamptz)') is null
  and not has_table_privilege('authenticated', 'public.day_closes', 'select')
  and not has_function_privilege('authenticated', 'public.shift_qris_expected(uuid)', 'execute'));

insert into auth.users(id, email) values ('e7500000-0000-0000-0000-000000000001', 'mimi@kopi.id'), ('e7500000-0000-0000-0000-000000000002', 'nana@lain.id');
select set_config('request.jwt.claim.sub', 'e7500000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Mimi', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Mimi', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Mimi'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select set_config('t.roti', public.create_product(current_setting('t.o')::uuid, null, 'Roti bakar', 6000, 18000, 100)::text, false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);
select set_config('t.d', (select business_date::text from public.shifts where id = current_setting('t.sh')::uuid), false);

-- Kopi cash 22.000; roti QRIS 18.000; kopi QRIS 22.000 refunded by QRIS. The shift should hold 18.000 of QRIS.
select set_config('t.a', pg_temp.pay('t.kopi', 'q-a', 'cash')::text, false);
select pg_temp.pay('t.roti', 'q-b', 'qris');
select set_config('t.r', pg_temp.pay('t.kopi', 'q-c', 'qris')::text, false);
select public.refund_items_approved(current_setting('t.r')::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting('t.r')::uuid), 'quantity', 1, 'restock', true)),
  'qris', 'Salah pesan', '271828', 'q-rf');

-- ===== QRIS at shift close
select pg_temp.fails('Q1 the QRIS total cannot be negative', format('select public.close_shift_at(%L, 122000, null, -1)', current_setting('t.sh')), 'QRIS tidak valid');
select set_config('t.close', public.close_shift_at(current_setting('t.sh')::uuid, 122000, null, 17000)::text, false);
select pg_temp.ok('Q2 QRIS expected 18.000, reported 17.000, difference -1.000; cash matches',
  (current_setting('t.close')::jsonb ->> 'qris_expected')::numeric = 18000 and (current_setting('t.close')::jsonb ->> 'qris_variance')::numeric = -1000
  and (select qris_expected = 18000 and qris_reported = 17000 and qris_variance = -1000 and variance = 0 from public.shifts where id = current_setting('t.sh')::uuid));
select pg_temp.ok('Q3 sending the same close again returns the stored result',
  (public.close_shift_at(current_setting('t.sh')::uuid, 122000, null, 17000) ->> 'qris_variance')::numeric = -1000);
select pg_temp.ok('Q4 the Shift page data shows the count and the difference, checks clean',
  (pg_temp.day() -> 'shifts' -> 0 ->> 'qrisReported')::numeric = 17000 and (pg_temp.day() -> 'shifts' -> 0 ->> 'qrisVariance')::numeric = -1000
  and (pg_temp.day() -> 'shifts' -> 0 ->> 'qrisExpected')::numeric = 18000 and pg_temp.day() -> 'checks' = '[]'::jsonb
  and pg_temp.day() -> 'closed' = 'null'::jsonb);
reset role;
select pg_temp.ok('Q5 ledger: the QRIS difference is posted and the books still balance; P&L shows -1.000',
  (select sum(amount) from public.ledger where business_id = current_setting('t.b')::uuid and account = 'qris') = 17000
  and public.ledger_checks(current_setting('t.b')::uuid, current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day') = '[]'::jsonb
  and (public.report_pnl(current_setting('t.b')::uuid, null, now() - interval '1 day', now() + interval '1 day') ->> 'qrisDifference')::numeric = -1000
  and (public.report_pnl(current_setting('t.b')::uuid, null, now() - interval '1 day', now() + interval '1 day') ->> 'operatingProfit')::numeric
    = (22000 + 18000 + 22000 - 22000) - (8000 + 6000 + 8000 - 8000) - 1000);
set role authenticated;

-- ===== no day lock (078)
select pg_temp.fails('N1 the owner cannot close a day any more',
  format('select public.owner_close_day(%L, %L, null, %L)', current_setting('t.o'), current_setting('t.d'), ''), 'permission denied');
-- A day closed before 078 stays as history but no longer blocks anything.
reset role;
insert into public.day_closes(outlet_id, business_date) values (current_setting('t.o')::uuid, current_setting('t.d')::date);
set role authenticated;
select public.owner_add_cash_movement(current_setting('t.sh')::uuid, 'out', 1000, 'Diambil pemilik');
select pg_temp.ok('N2 a closed shift of a day closed before 078 still takes Uang keluar: expected 121.000, variance +1.000',
  (select expected_cash = 121000 and variance = 1000 from public.shifts where id = current_setting('t.sh')::uuid));
select public.owner_add_cash_movement(current_setting('t.sh')::uuid, 'in', 1000, 'Salah catat');
select pg_temp.ok('N3 Uang masuk puts it back: expected 122.000, variance 0',
  (select expected_cash = 122000 and variance = 0 from public.shifts where id = current_setting('t.sh')::uuid));
reset role;
select pg_temp.ok('N4 the books still balance',
  public.ledger_checks(current_setting('t.b')::uuid, current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day') = '[]'::jsonb);
