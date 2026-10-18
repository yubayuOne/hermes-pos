-- Tests for 046 (a phone belongs to one outlet) on top of 001 to 046.
-- Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;

insert into auth.users(id, email) values ('b4600000-0000-0000-0000-000000000001', 'dua@kedai.id');
select set_config('request.jwt.claim.sub', 'b4600000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kedai Dua', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o1', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days', extra_outlets = 1 where business_id = current_setting('t.b')::uuid;
set role authenticated;
select set_config('t.o2', public.owner_create_outlet('Cabang')::text, false);
select public.owner_create_cashier(current_setting('t.o1')::uuid, 'Andi', '111111');
select public.owner_create_cashier(current_setting('t.o2')::uuid, 'Budi', '222222');
select set_config('t.a', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Andi'), false);
select set_config('t.bu', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Budi'), false);

select pg_temp.ok('L1 no outlet: both cashiers, as before', (select count(*) from public.list_device_cashiers()) = 2);
select pg_temp.ok('L2 outlet 1: only Andi',
  (select count(*) from public.list_device_cashiers(current_setting('t.o1')::uuid)) = 1
  and (select cashier_name from public.list_device_cashiers(current_setting('t.o1')::uuid)) = 'Andi');
select pg_temp.ok('L3 outlet 2: only Budi', (select cashier_name from public.list_device_cashiers(current_setting('t.o2')::uuid)) = 'Budi');
select pg_temp.ok('L4 unknown outlet: empty', (select count(*) from public.list_device_cashiers(gen_random_uuid())) = 0);

select pg_temp.ok('V1 right outlet and PIN', (public.verify_cashier_pin(current_setting('t.a')::uuid, '111111', current_setting('t.o1')::uuid) ->> 'ok')::boolean);
select pg_temp.ok('V2 cashier of another outlet: not_found even with the right PIN',
  public.verify_cashier_pin(current_setting('t.a')::uuid, '111111', current_setting('t.o2')::uuid) ->> 'reason' = 'not_found');
select public.verify_cashier_pin(current_setting('t.a')::uuid, '000000', current_setting('t.o2')::uuid) from generate_series(1, 6);
select pg_temp.ok('V3 wrong outlet never locks the cashier',
  (public.verify_cashier_pin(current_setting('t.a')::uuid, '111111', current_setting('t.o1')::uuid) ->> 'ok')::boolean);
select pg_temp.ok('V4 no outlet: old call still works', (public.verify_cashier_pin(current_setting('t.bu')::uuid, '222222') ->> 'ok')::boolean);
select pg_temp.ok('V5 wrong PIN in the right outlet counts down',
  public.verify_cashier_pin(current_setting('t.bu')::uuid, '000000', current_setting('t.o2')::uuid) ->> 'reason' = 'wrong');
