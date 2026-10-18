-- Tests for 067 (bill edit log, voucher use given back on void) on top of 001 to 067.
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
create or replace function pg_temp.pay(payload jsonb, k text) returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    payload, 'cash', 1000000, null, k, null, null) ->> 'transactionId')::uuid
$$;
create or replace function pg_temp.kopi(q int, voucher text default null) returns jsonb language sql as $$
  select jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', current_setting('t.kopi'), 'quantity', q)))
    || case when voucher is null then '{}'::jsonb else jsonb_build_object('voucher_code', voucher) end
$$;
create or replace function pg_temp.line(tx text, q int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('itemId', (select id from public.transaction_items where transaction_id = current_setting(tx)::uuid), 'quantity', q))
$$;
create or replace function pg_temp.edits(tx text) returns jsonb language sql as $$
  select public.owner_list_bill_edits(current_setting(tx)::uuid)
$$;
create or replace function pg_temp.used() returns int language sql as $$
  select used_count from public.vouchers where code = 'SEKALI'
$$;

select pg_temp.ok('S1 the log table is closed to clients', not has_table_privilege('authenticated', 'public.transaction_edits', 'select')
  and not has_table_privilege('authenticated', 'public.transaction_edits', 'insert'));
select pg_temp.ok('S2 the 066 workers are internal now', not has_function_privilege('authenticated', 'public._066_update_bill_items(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public._066_void_bill(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public._067_begin(uuid)', 'execute'));
select pg_temp.ok('S3 owners call the logged versions', has_function_privilege('authenticated', 'public.owner_update_bill_items(uuid, jsonb, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_list_bill_edits(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.owner_list_bill_edits(uuid)', 'execute'));

insert into auth.users(id, email) values ('e6700000-0000-0000-0000-000000000001', 'dewi@kopi.id'), ('e6700000-0000-0000-0000-000000000002', 'andi@lain.id');
select set_config('request.jwt.claim.sub', 'e6700000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Dewi', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Dewi', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Dewi'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);
select set_config('t.a', pg_temp.pay(pg_temp.kopi(2), 'p-a')::text, false);

-- ===== the log
select pg_temp.fails('L1 item change needs a reason', format('select public.owner_update_bill_items(%L, %L, %L)', current_setting('t.a'), pg_temp.line('t.a', 1), 'x'), 'Alasan perubahan');
select pg_temp.fails('L2 payment change needs a reason', format('select public.owner_set_bill_payment(%L, %L, null)', current_setting('t.a'), 'qris'), 'Alasan perubahan');
select pg_temp.ok('L3 refused edits leave no row', pg_temp.edits('t.a') = '[]'::jsonb);
select public.owner_update_bill_items(current_setting('t.a')::uuid, pg_temp.line('t.a', 1), '  Tamu batal satu ');
select pg_temp.ok('L4 item change logged with reason and the bill before and after',
  jsonb_array_length(pg_temp.edits('t.a')) = 1 and pg_temp.edits('t.a') -> 0 ->> 'kind' = 'items'
  and pg_temp.edits('t.a') -> 0 ->> 'reason' = 'Tamu batal satu'
  and (pg_temp.edits('t.a') -> 0 -> 'before' ->> 'total')::numeric = 44000 and (pg_temp.edits('t.a') -> 0 -> 'after' ->> 'total')::numeric = 22000
  and (pg_temp.edits('t.a') -> 0 -> 'before' -> 'items' -> 0 ->> 'quantity')::numeric = 2
  and pg_temp.edits('t.a') -> 0 -> 'before' -> 'items' -> 0 ->> 'productName' = 'Kopi susu');
reset role;
select pg_temp.ok('L5 the row names who edited', (select edited_by from public.transaction_edits where transaction_id = current_setting('t.a')::uuid) = 'e6700000-0000-0000-0000-000000000001');
set role authenticated;
select public.owner_set_bill_payment(current_setting('t.a')::uuid, 'cash', 'tidak berubah');
select pg_temp.ok('L6 same method: nothing changed, nothing logged', jsonb_array_length(pg_temp.edits('t.a')) = 1);
select public.owner_set_bill_payment(current_setting('t.a')::uuid, 'qris', 'Salah tekan tunai');
select public.owner_update_bill_details(current_setting('t.a')::uuid, 'Bu Rina', '5', null);
select public.owner_update_bill_details(current_setting('t.a')::uuid, 'Bu Rina', '5', null);
select pg_temp.ok('L7 payment and details logged, a save without changes is not',
  jsonb_array_length(pg_temp.edits('t.a')) = 3 and pg_temp.edits('t.a') -> 1 -> 'after' ->> 'paymentMethod' = 'qris'
  and pg_temp.edits('t.a') -> 2 ->> 'kind' = 'details' and pg_temp.edits('t.a') -> 2 -> 'after' ->> 'customerName' = 'Bu Rina'
  and pg_temp.edits('t.a') -> 2 ->> 'reason' is null);
select pg_temp.ok('L8 the bill list counts the edits',
  (public.owner_list_bills(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day') -> 'rows' -> 0 ->> 'editCount')::int = 3);

-- ===== voucher use given back on void
select public.owner_save_voucher(null, 'SEKALI', 'bill', 'amount', 2000, 0, 1, (now() at time zone 'Asia/Jakarta')::date + 10, null);
select set_config('t.v1', pg_temp.pay(pg_temp.kopi(1, 'SEKALI'), 'p-v1')::text, false);
select pg_temp.ok('V1 quota 1 used', pg_temp.used() = 1);
select pg_temp.fails('V2 used up', $q$select pg_temp.pay(pg_temp.kopi(1, 'SEKALI'), 'p-v2')$q$, 'voucher');
select public.void_transaction_approved(current_setting('t.v1')::uuid, 'Salah input', '271828');
select pg_temp.ok('V3 POS void gives the use back', pg_temp.used() = 0);
select pg_temp.ok('V4 replay of the voided payment does not count again',
  (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, pg_temp.kopi(1, 'SEKALI'),
    'cash', 1000000, null, 'p-v1', null, null) ->> 'transactionId')::uuid = current_setting('t.v1')::uuid and pg_temp.used() = 0);
select set_config('t.v2', pg_temp.pay(pg_temp.kopi(1, 'SEKALI'), 'p-v3')::text, false);
select pg_temp.ok('V5 the voucher works again', pg_temp.used() = 1);
select public.owner_void_bill(current_setting('t.v2')::uuid, 'Pesanan dobel');
select pg_temp.ok('V6 backoffice void gives it back too, and is logged', pg_temp.used() = 0
  and pg_temp.edits('t.v2') -> 0 ->> 'kind' = 'void' and pg_temp.edits('t.v2') -> 0 ->> 'reason' = 'Pesanan dobel'
  and pg_temp.edits('t.v2') -> 0 -> 'after' ->> 'status' = 'voided');

-- ===== other owners
select set_config('request.jwt.claim.sub', 'e6700000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Andi', 'Satu', null);
select pg_temp.fails('X1 other owner cannot read the log', 'select pg_temp.edits(''t.a'')', 'tidak ditemukan');
select pg_temp.fails('X2 other owner cannot edit', format('select public.owner_update_bill_details(%L, %L, %L, null)', current_setting('t.a'), 'x', ''), 'tidak ditemukan');
reset role;
