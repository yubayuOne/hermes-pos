-- Tests for 094 (a held bill keeps its voucher code: saved, recalled, changed, cleared). Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
create or replace function pg_temp.item(pid text, q int) returns jsonb language sql as $$
  select jsonb_build_object('product_id', current_setting(pid), 'quantity', q)
$$;

insert into auth.users(id, email) values ('94000000-0000-0000-0000-000000000001', 'voucher@tahan.id');
select set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Tahan Voucher', 'Pusat', null)::text, false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = (current_setting('t.reg')::jsonb ->> 'business_id')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Rina', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Rina'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi', 6000, 22000, 100)::text, false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);

-- Held with a voucher, recalled: the code comes back.
select set_config('t.bill', public.save_held_bill(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
  jsonb_build_object('table_number', 'M1', 'voucher_code', 'HEMAT10', 'items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'hv-1')::text, false);
select pg_temp.ok('H1 held with a voucher: the recalled bill has the code',
  (public.recall_held_bill_with_items(current_setting('t.bill')::uuid) ->> 'voucherCode') = 'HEMAT10');

-- Changed and the voucher taken off: the code is cleared.
select public.update_held_bill(current_setting('t.bill')::uuid, jsonb_build_object('table_number', 'M1', 'items', jsonb_build_array(pg_temp.item('t.kopi', 1))));
select pg_temp.ok('H2 update without a voucher clears it', (public.recall_held_bill_with_items(current_setting('t.bill')::uuid) ->> 'voucherCode') is null);

-- A bill held without any voucher has none.
select set_config('t.bill2', public.save_held_bill(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
  jsonb_build_object('table_number', 'M2', 'items', jsonb_build_array(pg_temp.item('t.kopi', 1))), 'hv-2')::text, false);
select pg_temp.ok('H3 held without a voucher: no code', (public.recall_held_bill_with_items(current_setting('t.bill2')::uuid) ->> 'voucherCode') is null);
