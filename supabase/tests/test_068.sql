-- Tests for 068 (a full refund gives the voucher use back) on top of 001 to 068.
-- Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
create or replace function pg_temp.pay(q int, k text) returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', current_setting('t.kopi'), 'quantity', q)), 'voucher_code', 'DUAKALI'),
    'cash', 1000000, null, k, null, null) ->> 'transactionId')::uuid
$$;
create or replace function pg_temp.refund(tx text, q int, k text) returns jsonb language sql as $$
  select public.refund_items_approved(current_setting(tx)::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
    jsonb_build_array(jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting(tx)::uuid), 'quantity', q, 'restock', false)),
    'cash', 'Salah pesan', '271828', k)
$$;
create or replace function pg_temp.used() returns int language sql as $$
  select used_count from public.vouchers where code = 'DUAKALI'
$$;

insert into auth.users(id, email) values ('e6800000-0000-0000-0000-000000000001', 'eka@kopi.id');
select set_config('request.jwt.claim.sub', 'e6800000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Eka', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Eka', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Eka'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);
select public.owner_save_voucher(null, 'DUAKALI', 'bill', 'amount', 2000, 0, 2, (now() at time zone 'Asia/Jakarta')::date + 10, null);

-- A: 2 kopi with the voucher, 42.000. B: 1 kopi with the voucher, 20.000.
select set_config('t.a', pg_temp.pay(2, 'p-a')::text, false);
select set_config('t.bb', pg_temp.pay(1, 'p-b')::text, false);
select pg_temp.ok('R1 both uses counted', pg_temp.used() = 2);
select pg_temp.refund('t.a', 1, 'r-1');
select pg_temp.ok('R2 partial refund keeps the use', pg_temp.used() = 2);
select pg_temp.refund('t.a', 1, 'r-2');
select pg_temp.ok('R3 the last refund gives it back', pg_temp.used() = 1
  and (select refunded_total = total from public.transactions where id = current_setting('t.a')::uuid));
select pg_temp.ok('R4 a replayed refund changes nothing', (pg_temp.refund('t.a', 1, 'r-2') ->> 'replayed')::boolean and pg_temp.used() = 1);
select pg_temp.refund('t.bb', 1, 'r-3');
select pg_temp.ok('R5 a one-step full refund gives it back too', pg_temp.used() = 0);
reset role;
