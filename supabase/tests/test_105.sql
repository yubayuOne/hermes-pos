-- Tests for 105 (a voucher without an end date). Every line of output must start with PASS.
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

insert into auth.users(id, email) values ('10500000-0000-0000-0000-000000000001', 'pemilik@voucher.id');
select set_config('request.jwt.claim.sub', '10500000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Warung Voucher', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;

select set_config('t.free', public.owner_save_voucher(null, 'BEBAS', 'bill', 'amount', 5000, 0, null, null, null)::text, false);
select pg_temp.ok('U1 a voucher without an end date is saved',
  current_setting('t.free') is not null and (select expires_on is null from public.vouchers where id = current_setting('t.free')::uuid));
select pg_temp.ok('U2 it is listed with no end date and status active',
  (select x ->> 'expires_on' is null and x ->> 'status' = 'active'
   from jsonb_array_elements(public.owner_list_vouchers()) x where x ->> 'code' = 'BEBAS'));
select pg_temp.fails('U3 a date in the past is still refused',
  format('select public.owner_save_voucher(null, %L, %L, %L, %s, 0, null, %L, null)', 'LAMPAU', 'bill', 'amount', 5000, current_date - 1),
  'Tanggal berakhir tidak boleh sebelum hari ini');
select set_config('t.dated', public.owner_save_voucher(null, 'BERTANGGAL', 'bill', 'amount', 5000, 0, null, current_date + 30, null)::text, false);
select public.owner_save_voucher(current_setting('t.dated')::uuid, 'BERTANGGAL', 'bill', 'amount', 5000, 0, null, null, null);
select pg_temp.ok('U4 a dated voucher can be changed to no end date',
  (select expires_on is null from public.vouchers where id = current_setting('t.dated')::uuid));

reset role;
select pg_temp.ok('U5 the POS finds it and it is not expired',
  (public._032_find_voucher(current_setting('t.o')::uuid, 'BEBAS', false)).code = 'BEBAS');
select pg_temp.ok('U6 the status helper treats no end date as active',
  public.voucher_status((select v from public.vouchers v where id = current_setting('t.free')::uuid), current_date + 3000) = 'active');
