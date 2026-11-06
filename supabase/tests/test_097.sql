-- Tests for 097 (bill numbers unique per outlet, not across the database). Every line of output must start with PASS.
-- Two outlets of two businesses sell on the same day from their first phone (code A1), so they make the same number.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
-- The result of an insert: 'ok', or the database error text.
create or replace function pg_temp.try_bill(o uuid, s uuid, c uuid, n text) returns text language plpgsql as $$
begin
  insert into public.transactions(shift_id, cashier_id, outlet_id, number, status, total) values (s, c, o, n, 'completed', 1000);
  return 'ok';
exception when others then return sqlerrm;
end $$;

insert into auth.users(id, email) values ('97000000-0000-0000-0000-000000000001', 'mira@kopi.id'), ('97000000-0000-0000-0000-000000000002', 'nina@toko.id');

-- Mira: business and outlet, a subscription, a cashier, and an open shift.
select set_config('request.jwt.claim.sub', '97000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.regA', public.register_business('Kopi Mira', 'Pusat', null)::text, false);
select set_config('t.bA', current_setting('t.regA')::jsonb ->> 'business_id', false);
select set_config('t.oA', current_setting('t.regA')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.bA')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.oA')::uuid, 'Mira', '123456');
select set_config('t.cA', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Mira'), false);
select public.owner_set_void_code('271828');
select set_config('t.sA', public.open_shift(current_setting('t.cA')::uuid, current_setting('t.oA')::uuid, 0)::text, false);

-- Nina: another business, the same steps.
select set_config('request.jwt.claim.sub', '97000000-0000-0000-0000-000000000002', false);
select set_config('t.regB', public.register_business('Toko Nina', 'Satu', null)::text, false);
select set_config('t.bB', current_setting('t.regB')::jsonb ->> 'business_id', false);
select set_config('t.oB', current_setting('t.regB')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.bB')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.oB')::uuid, 'Nina', '654321');
select set_config('t.cB', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Nina'), false);
select public.owner_set_void_code('314159');
select set_config('t.sB', public.open_shift(current_setting('t.cB')::uuid, current_setting('t.oB')::uuid, 0)::text, false);
reset role;

-- The same number in two outlets: both bills are kept.
select pg_temp.ok('N1 outlet A makes #HPOS-20261106-A1-0001',
  pg_temp.try_bill(current_setting('t.oA')::uuid, current_setting('t.sA')::uuid, current_setting('t.cA')::uuid, '#HPOS-20261106-A1-0001') = 'ok');
select pg_temp.ok('N2 outlet B (another business) makes the same number on the same day',
  pg_temp.try_bill(current_setting('t.oB')::uuid, current_setting('t.sB')::uuid, current_setting('t.cB')::uuid, '#HPOS-20261106-A1-0001') = 'ok');

-- One outlet still never repeats a number.
select pg_temp.ok('N3 the same outlet refuses a repeated number, and the error names the per-outlet index',
  pg_temp.try_bill(current_setting('t.oA')::uuid, current_setting('t.sA')::uuid, current_setting('t.cA')::uuid, '#HPOS-20261106-A1-0001') like '%transactions_outlet_number%');

-- The global constraint is gone; the per-outlet index exists.
select pg_temp.ok('N4 no database-wide unique on transactions.number; a unique index on (outlet_id, number) exists',
  not exists (select 1 from pg_constraint where conrelid = 'public.transactions'::regclass and conname = 'transactions_number_key')
  and exists (select 1 from pg_indexes where tablename = 'transactions' and indexname = 'transactions_outlet_number'
              and indexdef like '%(outlet_id, number)%' and indexdef like '%UNIQUE%'));
