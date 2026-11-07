-- Tests for 104 (outlet income: money that goes straight into the outlet's cash, outside any shift). Every line of output must start with PASS.
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

insert into auth.users(id, email) values ('10400000-0000-0000-0000-000000000001', 'pemilik@kas.id'), ('10400000-0000-0000-0000-000000000002', 'lain@kas.id');
select set_config('request.jwt.claim.sub', '10400000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Warung Kas', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;

select set_config('request.jwt.claim.sub', '10400000-0000-0000-0000-000000000002', false);
set role authenticated;
select set_config('t.reg2', public.register_business('Warung Lain', 'Pusat', null)::text, false);
select set_config('t.o2', current_setting('t.reg2')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = (current_setting('t.reg2')::jsonb ->> 'business_id')::uuid;

select set_config('request.jwt.claim.sub', '10400000-0000-0000-0000-000000000001', false);
set role authenticated;

select pg_temp.ok('K1 the first income is recorded and returned with its date and reason',
  (public.owner_add_outlet_income(current_setting('t.o')::uuid, current_date, 50000, 'Modal tambahan') ->> 'amount')::numeric = 50000);
select pg_temp.ok('K2 an income on an earlier day is recorded too',
  (public.owner_add_outlet_income(current_setting('t.o')::uuid, current_date - 3, 20000, 'Uang titipan') ->> 'businessDate')::date = current_date - 3);
select pg_temp.ok('K3 the list counts both and sums them',
  (public.owner_list_outlet_income(current_setting('t.o')::uuid, current_date - 10, current_date, 1) ->> 'total')::int = 2
  and (public.owner_list_outlet_income(current_setting('t.o')::uuid, current_date - 10, current_date, 1) ->> 'sum')::numeric = 70000
  and jsonb_array_length(public.owner_list_outlet_income(current_setting('t.o')::uuid, current_date - 10, current_date, 1) -> 'rows') = 2);
select pg_temp.ok('K4 the newest income is listed first',
  (public.owner_list_outlet_income(current_setting('t.o')::uuid, current_date - 10, current_date, 1) -> 'rows' -> 0 ->> 'amount')::numeric = 50000);
select pg_temp.ok('K5 a page past the last is empty; the total and sum still count all',
  jsonb_array_length(public.owner_list_outlet_income(current_setting('t.o')::uuid, current_date - 10, current_date, 2) -> 'rows') = 0
  and (public.owner_list_outlet_income(current_setting('t.o')::uuid, current_date - 10, current_date, 2) ->> 'sum')::numeric = 70000);
select pg_temp.ok('K6 a period outside the income gives zero',
  (public.owner_list_outlet_income(current_setting('t.o')::uuid, current_date - 60, current_date - 30, 1) ->> 'sum')::numeric = 0);
select set_config('t.ledger', (select count(*)::text from public.cash_ledger), false);
select pg_temp.ok('K7 the income does not touch the drawer ledger (no shift, no ledger rows)',
  current_setting('t.ledger')::int = 0);

select pg_temp.fails('K8 zero is refused',
  format('select public.owner_add_outlet_income(%L, current_date, 0, %L)', current_setting('t.o'), 'Modal tambahan'), 'Nominal harus angka bulat');
select pg_temp.fails('K9 a fraction is refused',
  format('select public.owner_add_outlet_income(%L, current_date, 1.5, %L)', current_setting('t.o'), 'Modal tambahan'), 'Nominal harus angka bulat');
select pg_temp.fails('K10 more than one billion is refused',
  format('select public.owner_add_outlet_income(%L, current_date, 1000000001, %L)', current_setting('t.o'), 'Modal tambahan'), 'Nominal harus angka bulat');
select pg_temp.fails('K11 a reason under three letters is refused',
  format('select public.owner_add_outlet_income(%L, current_date, 1000, %L)', current_setting('t.o'), 'ab'), 'Alasan wajib diisi');
select pg_temp.fails('K12 a date after today is refused',
  format('select public.owner_add_outlet_income(%L, %L, 1000, %L)', current_setting('t.o'), current_date + 1, 'Modal tambahan'), 'Tanggal tidak boleh di masa depan');
select set_config('request.jwt.claim.sub', '10400000-0000-0000-0000-000000000002', false);
select pg_temp.fails('K13 another owner cannot add to this outlet',
  format('select public.owner_add_outlet_income(%L, current_date, 1000, %L)', current_setting('t.o'), 'Modal tambahan'), 'Outlet tidak ditemukan');
select set_config('request.jwt.claim.sub', '10400000-0000-0000-0000-000000000001', false);

select set_config('t.id', (public.owner_list_outlet_income(current_setting('t.o')::uuid, current_date - 10, current_date, 1) -> 'rows' -> 1 ->> 'id'), false);
select set_config('t.upd', (public.owner_update_outlet_income(current_setting('t.id')::uuid, current_date - 3, 25000, 'Uang titipan tambahan') ->> 'amount'), false);
select pg_temp.ok('K14 an income can be changed: amount, date and reason',
  current_setting('t.upd')::numeric = 25000
  and (public.owner_list_outlet_income(current_setting('t.o')::uuid, current_date - 10, current_date, 1) ->> 'sum')::numeric = 75000);
select set_config('request.jwt.claim.sub', '10400000-0000-0000-0000-000000000002', false);
select pg_temp.fails('K15 another owner cannot change it',
  format('select public.owner_update_outlet_income(%L, current_date, 1000, %L)', current_setting('t.id'), 'Modal tambahan'), 'Pemasukan tidak ditemukan');
select set_config('request.jwt.claim.sub', '10400000-0000-0000-0000-000000000001', false);
select public.owner_delete_outlet_income(current_setting('t.id')::uuid);
select set_config('request.jwt.claim.sub', '10400000-0000-0000-0000-000000000001', false);
select pg_temp.ok('K16 an income can be deleted; the sum follows',
  (public.owner_list_outlet_income(current_setting('t.o')::uuid, current_date - 10, current_date, 1) ->> 'sum')::numeric = 50000);
select pg_temp.ok('K18 with no outlet, the list covers every outlet of the business and no other business',
  (public.owner_list_outlet_income(null, current_date - 10, current_date, 1) ->> 'sum')::numeric = 50000
  and (public.owner_list_outlet_income(null, current_date - 10, current_date, 1) ->> 'total')::int = 1);
select pg_temp.ok('K17 the ledger is still empty after every income change',
  (select count(*) from public.cash_ledger) = current_setting('t.ledger')::int);
