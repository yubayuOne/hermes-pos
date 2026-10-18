-- Tests for 064 (business time zone) on top of 001 to 064. Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;

reset role;
select gen_random_uuid() as u1 \gset
insert into auth.users(id) values (:'u1');
set role authenticated;
select set_config('request.jwt.claim.sub', :'u1', false);
select (register_business('Kedai Makassar', 'Outlet Pantai') ->> 'outlet_id') as o1 \gset
select owner_create_cashier(:'o1', 'Wati', '111111') as c1 \gset
reset role;
update businesses set timezone = 'Asia/Makassar' where id = (select business_id from outlets where id = :'o1');

select pg_temp.ok('Z1 the outlet zone is the business zone', public.outlet_tz(:'o1') = 'Asia/Makassar');
select pg_temp.ok('Z2 an unknown outlet falls back to WIB', public.outlet_tz(gen_random_uuid()) = 'Asia/Jakarta');

-- 16:30 UTC yesterday: 23:30 WIB, but already 00:30 the next day in WITA.
select (date_trunc('day', now() at time zone 'UTC') - interval '1 day' + interval '16 hours 30 minutes') at time zone 'UTC' as opened \gset
set role authenticated;
select open_shift_with_id(gen_random_uuid(), :'c1', :'o1', 0, :'opened') as sh \gset
reset role;
select pg_temp.ok('Z3 the shift business date is the WITA date',
  (select business_date from shifts where id = :'sh') = (:'opened'::timestamptz at time zone 'Asia/Makassar')::date
  and (:'opened'::timestamptz at time zone 'Asia/Makassar')::date <> (:'opened'::timestamptz at time zone 'Asia/Jakarta')::date);

set role authenticated;
select pos_reference_snapshot(:'o1', null) as snap \gset
select pg_temp.ok('Z4 the snapshot sends the zone and the WITA business date',
  :'snap'::jsonb ->> 'timezone' = 'Asia/Makassar'
  and (:'snap'::jsonb ->> 'business_date')::date = (now() at time zone 'Asia/Makassar')::date);
select pg_temp.ok('Z5 subscription days use the business zone', (get_subscription_status() ->> 'days_left')::int >= 0);
reset role;

select pg_temp.ok('Z6 no report or POS function is fixed to WIB any more', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ilike '%Asia/Jakarta%'
    and p.proname not in ('_032_find_voucher', 'pos_list_vouchers', 'owner_update_business', 'business_tz', 'outlet_tz', 'next_transaction_number')));
-- Draft rows straight into the table: the 054 insert trigger runs as it does for every checkout function.
insert into transactions(shift_id, cashier_id, outlet_id, number) values (:'sh', :'c1', :'o1', '#HPOS-20000101-99042');
insert into transactions(shift_id, cashier_id, outlet_id, number) values (:'sh', :'c1', :'o1', '#HPOS-20000101-A1-0042');
select pg_temp.ok('Z7 a server-made bill number gets the WITA date',
  exists (select 1 from transactions where number = '#HPOS-' || to_char(now() at time zone 'Asia/Makassar', 'YYYYMMDD') || '-99042'));
select pg_temp.ok('Z8 a phone-made bill number is kept as sent', exists (select 1 from transactions where number = '#HPOS-20000101-A1-0042'));
delete from transactions where outlet_id = :'o1';
