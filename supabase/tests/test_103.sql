-- Tests for 103 (owner_list_shifts: a period of shifts, ten a page). Every line of output must start with PASS.
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

insert into auth.users(id, email) values ('10300000-0000-0000-0000-000000000001', 'pemilik@daftar.id'), ('10300000-0000-0000-0000-000000000002', 'lain@daftar.id');
select set_config('request.jwt.claim.sub', '10300000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Warung Daftar', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Rini', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Rini'), false);
select public.owner_set_void_code('271828');
select public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0);

select pg_temp.ok('L1 one shift of today is listed, with its business day',
  (public.owner_list_shifts(current_setting('t.o')::uuid, current_date - 1, current_date, 1) ->> 'total')::int = 1
  and jsonb_array_length(public.owner_list_shifts(current_setting('t.o')::uuid, current_date - 1, current_date, 1) -> 'rows') = 1
  and (public.owner_list_shifts(current_setting('t.o')::uuid, current_date - 1, current_date, 1) -> 'rows' -> 0 ->> 'businessDate') is not null);
select pg_temp.ok('L2 the second page of a short list is empty, the total still counts all',
  jsonb_array_length(public.owner_list_shifts(current_setting('t.o')::uuid, current_date - 1, current_date, 2) -> 'rows') = 0
  and (public.owner_list_shifts(current_setting('t.o')::uuid, current_date - 1, current_date, 2) ->> 'total')::int = 1);
select pg_temp.ok('L3 a period with no shifts gives zero',
  (public.owner_list_shifts(current_setting('t.o')::uuid, current_date - 30, current_date - 20, 1) ->> 'total')::int = 0);
select pg_temp.fails('L4 a period longer than 400 days is refused',
  format('select public.owner_list_shifts(%L, %L, %L, 1)', current_setting('t.o'), current_date - 1000, current_date), 'Rentang tanggal terlalu panjang');
select pg_temp.fails('L5 an empty or reversed period is refused',
  format('select public.owner_list_shifts(%L, %L, %L, 1)', current_setting('t.o'), current_date, current_date - 1), 'Rentang tanggal tidak valid');

select set_config('request.jwt.claim.sub', '10300000-0000-0000-0000-000000000002', false);
select pg_temp.fails('L6 another owner cannot list this outlet',
  format('select public.owner_list_shifts(%L, %L, %L, 1)', current_setting('t.o'), current_date - 1, current_date), 'Outlet tidak ditemukan');
reset role;
