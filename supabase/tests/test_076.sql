-- Tests for 075's correction trail and 076 (void and shift-difference notifications, the nightly watch).
-- Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
create or replace function pg_temp.pay(pid text, k text, method text) returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', current_setting(pid), 'quantity', 1))),
    method::public.payment_method, 1000000, null, k, null, null) ->> 'transactionId')::uuid
$$;
create or replace function pg_temp.notes(k text) returns bigint language sql as $$
  select count(*) from public.notifications where business_id = current_setting('t.b')::uuid and kind = k
$$;

select pg_temp.ok('S1 the watch and the triggers are internal',
  not has_function_privilege('authenticated', 'public.watch_books()', 'execute')
  and not has_function_privilege('authenticated', 'public.trg_notify_void()', 'execute'));

insert into auth.users(id, email) values ('e7600000-0000-0000-0000-000000000001', 'oki@kopi.id');
select set_config('request.jwt.claim.sub', 'e7600000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Oki', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Oki', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Oki'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);
select set_config('t.d', (select business_date::text from public.shifts where id = current_setting('t.sh')::uuid), false);

-- ===== voids
select set_config('t.a', pg_temp.pay('t.kopi', 'w-a', 'cash')::text, false);
select set_config('t.x', pg_temp.pay('t.kopi', 'w-x', 'cash')::text, false);
select public.owner_void_bill(current_setting('t.a')::uuid, 'Pesanan dobel');
select public.owner_correct_bill(current_setting('t.x')::uuid,
  jsonb_build_array(jsonb_build_object('itemId', (select id from public.transaction_items where transaction_id = current_setting('t.x')::uuid), 'quantity', 2)),
  'cash', '', '', 'Salah jumlah');
reset role;
select pg_temp.ok('V1 a void notifies once with its amount and reason; a bill correction does not',
  pg_temp.notes('void') = 1
  and (select (params ->> 'amount')::numeric = 22000 and params ->> 'reason' = 'Pesanan dobel' and params ->> 'cashier' = 'Oki'
       from public.notifications where business_id = current_setting('t.b')::uuid and kind = 'void'));
set role authenticated;
select pg_temp.ok('T1 the day trail lists the void and the correction with their reasons',
  (select count(*) = 2 and bool_or(e ->> 'kind' = 'void' and e ->> 'reason' = 'Pesanan dobel')
     and bool_or(e ->> 'kind' = 'correction' and e ->> 'reason' = 'Salah jumlah')
   from jsonb_array_elements(public.owner_day_close(current_setting('t.o')::uuid, current_setting('t.d')::date) -> 'trail') e));

-- ===== shift differences: sales 44.000; cash short 300 (under 1%) is quiet, QRIS off by 500 (over 1%) notifies
select pg_temp.ok('N0 1% and Rp10.000 rule', not public.notable_difference(300, 44000) and public.notable_difference(500, 44000)
  and public.notable_difference(-10000, 5000000) and not public.notable_difference(0, 0) and public.notable_difference(1, 0));
select public.close_shift_at(current_setting('t.sh')::uuid, (select sum(case when direction = 'in' then amount else -amount end) from public.cash_ledger where shift_id = current_setting('t.sh')::uuid), null, 0);
reset role;
select pg_temp.ok('N1 a clean close is quiet', pg_temp.notes('shift_difference') = 0);
set role authenticated;
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
select pg_temp.pay('t.kopi', 'w-b', 'cash');
select pg_temp.pay('t.kopi', 'w-c', 'qris');
select public.close_shift_at(current_setting('t.sh')::uuid, 21700, null, 21500);
reset role;
select pg_temp.ok('N2 the QRIS difference notifies with both amounts',
  pg_temp.notes('shift_difference') = 1
  and (select (params ->> 'cash')::numeric = -300 and (params ->> 'qris')::numeric = -500
       from public.notifications where business_id = current_setting('t.b')::uuid and kind = 'shift_difference'));

-- ===== the nightly watch
select public.watch_books();
select pg_temp.ok('W1 nothing to report yet', pg_temp.notes('checks_failed') = 0 and pg_temp.notes('day_not_closed') = 0 and pg_temp.notes('shift_open_long') = 0);
-- Three days ago, a shift left open since then, and a cash book that no longer matches its shift.
update public.shifts set business_date = business_date - 3 where outlet_id = current_setting('t.o')::uuid;
set role authenticated;
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
reset role;
update public.shifts set opened_at = now() - interval '17 hours' where id = current_setting('t.sh')::uuid;
update public.shifts set expected_cash = expected_cash + 1 where outlet_id = current_setting('t.o')::uuid and status = 'closed' and shift_number = 1;
select public.watch_books();
select public.watch_books();
select pg_temp.ok('W2 once each: a check failed, a day not closed (1 day, 3 days ago), a shift open too long',
  pg_temp.notes('checks_failed') = 1 and pg_temp.notes('day_not_closed') = 1 and pg_temp.notes('shift_open_long') = 1
  and (select (params ->> 'days')::int = 1 and params ->> 'date' = (current_setting('t.d')::date - 3)::text
       from public.notifications where business_id = current_setting('t.b')::uuid and kind = 'day_not_closed'));
