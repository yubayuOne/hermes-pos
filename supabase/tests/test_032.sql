-- Tests for 032 (vouchers at the till, owner approval code for voids, cashier lock state) on top of 001 to 032.
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
-- Shorthand for a cash checkout of a payload.
create or replace function pg_temp.pay(payload jsonb, k text, received numeric default 1000000, existing uuid default null) returns jsonb language sql as $$
  select public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    payload, 'cash', received, null, k, null, existing)
$$;
create or replace function pg_temp.item(pid text, q int) returns jsonb language sql as $$
  select jsonb_build_object('product_id', current_setting(pid), 'quantity', q)
$$;

insert into auth.users(id, email) values ('b0000000-0000-0000-0000-000000000001', 'sari@kafe.id');
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Pojok', 'Outlet Utama', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Sari', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Sari'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select set_config('t.roti', public.create_product(current_setting('t.o')::uuid, null, 'Roti bakar', 6000, 18000, 100)::text, false);
select set_config('t.air', public.create_product(current_setting('t.o')::uuid, null, 'Air mineral', 2000, 6000, 1)::text, false);
select set_config('t.permen', public.create_product(current_setting('t.o')::uuid, null, 'Permen', 1000, 3000, 10)::text, false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);
select set_config('t.today', (now() at time zone 'Asia/Jakarta')::date::text, false);
select public.owner_save_voucher(null, 'HEMAT10', 'bill', 'percent', 10, 40000, 2, current_setting('t.today')::date + 10, null);
select public.owner_save_voucher(null, 'POTONG5K', 'bill', 'amount', 5000, 0, null, current_setting('t.today')::date + 10, null);
select public.owner_save_voucher(null, 'ROTI50', 'products', 'percent', 50, 0, null, current_setting('t.today')::date + 10, array[current_setting('t.roti')::uuid]);
select public.owner_save_voucher(null, 'ROTI25K', 'products', 'amount', 25000, 0, null, current_setting('t.today')::date + 10, array[current_setting('t.roti')::uuid]);
select public.owner_save_voucher(null, 'MATI', 'bill', 'amount', 5000, 0, null, current_setting('t.today')::date + 10, null);
select public.owner_set_voucher_active((select (x->>'id')::uuid from jsonb_array_elements(public.owner_list_vouchers()) x where x->>'code' = 'MATI'), false);
reset role;
insert into public.vouchers(business_id, code, scope, discount_type, value, expires_on)
values (current_setting('t.b')::uuid, 'LAMA', 'bill', 'amount', 5000, current_setting('t.today')::date - 1);
set role authenticated;

-- ===== preview
select pg_temp.ok('V1 preview returns the voucher', (public.pos_check_voucher(current_setting('t.c')::uuid, current_setting('t.o')::uuid, ' hemat10 ') ->> 'discount_type') = 'percent');
select pg_temp.ok('V2 preview lists product ids', jsonb_array_length(public.pos_check_voucher(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 'ROTI50') -> 'product_ids') = 1);
select pg_temp.fails('V3 unknown code', format('select public.pos_check_voucher(%L, %L, %L)', current_setting('t.c'), current_setting('t.o'), 'NOPE'), 'tidak ditemukan');
select pg_temp.fails('V4 inactive code', format('select public.pos_check_voucher(%L, %L, %L)', current_setting('t.c'), current_setting('t.o'), 'MATI'), 'dinonaktifkan');
select pg_temp.fails('V5 expired code', format('select public.pos_check_voucher(%L, %L, %L)', current_setting('t.c'), current_setting('t.o'), 'LAMA'), 'sudah berakhir');

-- ===== bill voucher
select set_config('t.r1', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2)), 'voucher_code', 'hemat10'), 'v-1')::text, false);
select pg_temp.ok('V6 10% bill voucher: 44.000 becomes 39.600', (current_setting('t.r1')::jsonb ->> 'total')::numeric = 39600);
select pg_temp.ok('V7 discount amount returned', (current_setting('t.r1')::jsonb ->> 'voucherDiscount')::numeric = 4400);
select pg_temp.ok('V8 voucher counted once', (select used_count from public.vouchers where code = 'HEMAT10') = 1);
select pg_temp.ok('V9 bill keeps the discount', (select bill_discount from public.transactions where id = (current_setting('t.r1')::jsonb ->> 'transactionId')::uuid) = 4400);
select pg_temp.ok('V10 replay returns the same bill', (pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2)), 'voucher_code', 'hemat10'), 'v-1') ->> 'transactionId') = current_setting('t.r1')::jsonb ->> 'transactionId');
select pg_temp.ok('V11 replay does not count again', (select used_count from public.vouchers where code = 'HEMAT10') = 1);
select pg_temp.ok('V12 one redemption row', (select count(*) from public.voucher_redemptions) = 1);
select pg_temp.fails('V13 min spend', $q$select pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1)), 'voucher_code', 'HEMAT10'), 'v-2')$q$, 'Belanja minimal');
select pg_temp.fails('V14 not with manual bill discount', $q$select pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2)), 'voucher_code', 'HEMAT10', 'bill_discount_type', 'percent', 'bill_discount_value', 5), 'v-3')$q$, 'diskon bill');
select pg_temp.ok('V15 second use within quota', (pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2)), 'voucher_code', 'HEMAT10'), 'v-4') ->> 'total')::numeric = 39600);
select pg_temp.fails('V16 quota used up', $q$select pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2)), 'voucher_code', 'HEMAT10'), 'v-5')$q$, 'habis');
-- 044: the till's voucher list shows only usable vouchers, in the pos_check_voucher shape.
select set_config('t.list', public.pos_list_vouchers(current_setting('t.c')::uuid, current_setting('t.o')::uuid)::text, false);
select pg_temp.ok('V16b list: POTONG5K, ROTI25K, ROTI50 only (no inactive, expired, or used up)',
  (select string_agg(x->>'code', ',' order by x->>'code') from jsonb_array_elements(current_setting('t.list')::jsonb) x) = 'POTONG5K,ROTI25K,ROTI50');
select pg_temp.ok('V16c list rows carry type, value, and product ids',
  (select (x->>'value')::numeric = 50 and x->>'discount_type' = 'percent' and jsonb_array_length(x->'product_ids') = 1
   from jsonb_array_elements(current_setting('t.list')::jsonb) x where x->>'code' = 'ROTI50'));
select pg_temp.fails('V17 amount voucher larger than bill', $q$select pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.permen', 1)), 'voucher_code', 'POTONG5K'), 'v-6')$q$, 'lebih besar');
select pg_temp.fails('V18 failed checkout (stock) does not count', $q$select pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.air', 5), pg_temp.item('t.kopi', 1)), 'voucher_code', 'POTONG5K'), 'v-7')$q$, 'Stok');
select pg_temp.ok('V19 ...and leaves the quota alone', (select used_count from public.vouchers where code = 'POTONG5K') = 0);
select pg_temp.fails('V20 not for split parts', format('select public.complete_checkout(%L,%L,%L,%L::jsonb,%L,50000,null,%L,%L,null)', current_setting('t.sh'), current_setting('t.c'), current_setting('t.o'),
  jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1)), 'voucher_code', 'POTONG5K'), 'cash', 'v-8', gen_random_uuid()), 'pisah bill');

-- ===== product voucher
select set_config('t.r2', pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1), pg_temp.item('t.roti', 2)), 'voucher_code', 'ROTI50'), 'v-9')::text, false);
select pg_temp.ok('V21 50% on roti only: 22.000 + 18.000', (current_setting('t.r2')::jsonb ->> 'total')::numeric = 40000);
select pg_temp.ok('V22 discount sits on the roti line', (select discount_amount from public.transaction_items where transaction_id = (current_setting('t.r2')::jsonb ->> 'transactionId')::uuid and product_id = current_setting('t.roti')::uuid) = 18000);
select pg_temp.ok('V23 amount per line capped at line price', (pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1), pg_temp.item('t.roti', 1)), 'voucher_code', 'ROTI25K'), 'v-10') ->> 'total')::numeric = 22000);
select pg_temp.fails('V24 product not in bill', $q$select pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1)), 'voucher_code', 'ROTI50'), 'v-11')$q$, 'menu tertentu');
select pg_temp.fails('V25 not with item discount on the same line', $q$select pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.roti', 1) || '{"discount_type":"amount","discount_value":1000}'), 'voucher_code', 'ROTI50'), 'v-12')$q$, 'diskon item');

-- ===== held bill, no voucher path, privileges
select set_config('t.held', public.save_held_bill(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
  jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1), pg_temp.item('t.roti', 1))), 'h-1')::text, false);
select pg_temp.ok('V26 voucher on a recalled held bill', (pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1), pg_temp.item('t.roti', 1)), 'voucher_code', 'POTONG5K'), 'v-13', 1000000, current_setting('t.held')::uuid) ->> 'total')::numeric = 35000);
select pg_temp.ok('V27 no voucher: unchanged', (pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'v-14') ->> 'total')::numeric = 22000);
select pg_temp.ok('V28 no voucher replay', (pg_temp.pay(jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'v-14') ->> 'total')::numeric = 22000);
select pg_temp.fails('V29 core not callable by the app', format('select public.complete_checkout_core(%L,%L,%L,%L::jsonb,%L,50000,null,%L,null,null)', current_setting('t.sh'), current_setting('t.c'), current_setting('t.o'), '{}', 'cash', 'v-15'), 'permission denied');
select pg_temp.fails('V30 redemptions not writable', $q$insert into public.voucher_redemptions(voucher_id, transaction_id, cashier_id, idempotency_key, payload) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x', '{}')$q$, 'permission denied');

-- ===== update a recalled held bill
select set_config('t.held2', public.save_held_bill(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
  jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1)), 'table_number', '4'), 'h-2')::text, false);
select pg_temp.ok('H1 update keeps the same bill', public.update_held_bill(current_setting('t.held2')::uuid,
  jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 2), pg_temp.item('t.roti', 1) || '{"note":"tanpa gula"}'), 'table_number', '7')) = current_setting('t.held2')::uuid);
select pg_temp.ok('H2 total follows the new cart', (select total from public.transactions where id = current_setting('t.held2')::uuid) = 62000);
select pg_temp.ok('H3 items replaced, note kept', (select count(*) = 2 and bool_or(note = 'tanpa gula') from public.transaction_items where transaction_id = current_setting('t.held2')::uuid));
select pg_temp.ok('H4 table updated', (select table_number from public.transactions where id = current_setting('t.held2')::uuid) = '7');
select pg_temp.ok('H5 still one held bill, stock untouched', (select status::text from public.transactions where id = current_setting('t.held2')::uuid) = 'held'
  and (select stock from public.products where id = current_setting('t.roti')::uuid) = 100 - 2 - 1 - 1);
select pg_temp.fails('H6 empty cart refused', format('select public.update_held_bill(%L, %L::jsonb)', current_setting('t.held2'), '{"items":[]}'), 'Bill kosong');
select public.start_split_from_held(current_setting('t.held2')::uuid);
select public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
  jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'cash', 22000, null, 'h-split-1', current_setting('t.held2')::uuid, null);
select pg_temp.fails('H7 refused after a split part was paid', format('select public.update_held_bill(%L, %L::jsonb)', current_setting('t.held2'),
  jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1)))), 'pisah bill');
select pg_temp.fails('H8 paid bill cannot be updated', format('select public.update_held_bill(%L, %L::jsonb)', current_setting('t.r2')::jsonb ->> 'transactionId',
  jsonb_build_object('items', jsonb_build_array(pg_temp.item('t.kopi', 1)))), 'Bill Ditahan');

-- ===== owner approval code
select set_config('t.tx', current_setting('t.r1')::jsonb ->> 'transactionId', false);
select pg_temp.ok('C1 no code yet', not (public.owner_void_code_status() ->> 'has_code')::boolean);
select pg_temp.ok('C2 void without a code set', (public.void_transaction_approved(current_setting('t.tx')::uuid, 'salah input', '123456') ->> 'reason') = 'no_code');
select pg_temp.fails('C3 code must be 6 digits', $q$select public.owner_set_void_code('12ab56')$q$, '6 digit');
select pg_temp.ok('C4 set code', (public.owner_set_void_code('481516') ->> 'has_code')::boolean);
select pg_temp.ok('C5 status shows the code exists', (public.owner_void_code_status() ->> 'has_code')::boolean);
select pg_temp.fails('C6 hash table not readable', $q$select * from public.business_void_codes$q$, 'permission denied');
select pg_temp.ok('C7 wrong code counts down', (public.void_transaction_approved(current_setting('t.tx')::uuid, 'salah input', '000000') ->> 'attempts_left')::int = 4);
select pg_temp.ok('C8 bill still completed after a wrong code', (select status::text from public.transactions where id = current_setting('t.tx')::uuid) = 'completed');
select public.void_transaction_approved(current_setting('t.tx')::uuid, 'salah input', '000000') from generate_series(1, 3);
select pg_temp.ok('C9 fifth wrong code locks', (public.void_transaction_approved(current_setting('t.tx')::uuid, 'salah input', '000000') ->> 'reason') = 'locked');
select pg_temp.ok('C10 locked even with the right code', (public.void_transaction_approved(current_setting('t.tx')::uuid, 'salah input', '481516') ->> 'reason') = 'locked');
reset role;
update public.business_void_codes set locked_until = now() - interval '1 second';
set role authenticated;
select pg_temp.fails('C11 reason still required', format('select public.void_transaction_approved(%L, %L, %L)', current_setting('t.tx'), 'x', '481516'), 'Alasan');
select pg_temp.ok('C12 right code voids', (public.void_transaction_approved(current_setting('t.tx')::uuid, 'salah input', '481516') ->> 'ok')::boolean);
select pg_temp.ok('C13 bill is voided', (select status::text from public.transactions where id = current_setting('t.tx')::uuid) = 'voided');
select pg_temp.fails('C14 plain void no longer callable', format('select public.void_transaction(%L, %L)', current_setting('t.r2')::jsonb ->> 'transactionId', 'salah input'), 'permission denied');
reset role;
update public.subscriptions set expires_at = now() - interval '1 hour' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select pg_temp.fails('C15 expired: void refused', format('select public.void_transaction_approved(%L, %L, %L)', current_setting('t.r2')::jsonb ->> 'transactionId', 'salah input', '481516'), 'Langganan berakhir');
select pg_temp.ok('C16 expired: owner can still change the code', (public.owner_set_void_code('271828') ->> 'has_code')::boolean);

-- ===== cashier list
select pg_temp.ok('L1 lock column empty when not locked', (select pin_locked_until is null from public.list_device_cashiers() where cashier_name = 'Sari'));
select public.verify_cashier_pin(current_setting('t.c')::uuid, '000000') from generate_series(1, 5);
select pg_temp.ok('L2 lock time shown after five wrong PINs', (select pin_locked_until > now() from public.list_device_cashiers() where cashier_name = 'Sari'));
select pg_temp.ok('L3 hash still hidden', not exists (select 1 from information_schema.columns where table_name = 'list_device_cashiers' and column_name = 'pin_hash'));
reset role;
