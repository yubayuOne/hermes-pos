-- Tests for 110 (Midtrans orders, settlement, platform admin). Every line of output must start with PASS.
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

insert into auth.users(id, email) values ('11000000-0000-0000-0000-000000000001', 'owner@midtrans.id'), ('11000000-0000-0000-0000-000000000002', 'admin@midtrans.id');
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Warung Midtrans', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '2 days' where business_id = current_setting('t.b')::uuid;
insert into public.admin_users(user_id) values ('11000000-0000-0000-0000-000000000002');

-- The owner's order
set role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', false);
select set_config('t.o1', public.owner_begin_midtrans('monthly', 0)->>'invoice', false);
select pg_temp.ok('M1 an order starts pending at the plan price', (public.owner_begin_midtrans('monthly', 0)->>'amount')::bigint = 147000
  and (public.owner_begin_midtrans('monthly', 0)->>'invoice') = current_setting('t.o1'));
select pg_temp.ok('M2 the same plan reuses the open order', (select count(*) from public.payment_confirmations where business_id = current_setting('t.b')::uuid and status = 'pending') = 1);
select set_config('t.o2', public.owner_begin_midtrans('annual', 1)->>'invoice', false);
select pg_temp.ok('M3 another plan replaces the open order: the old one is rejected',
  (select status from public.payment_confirmations where invoice_number = current_setting('t.o1')) = 'rejected'
  and (select status from public.payment_confirmations where invoice_number = current_setting('t.o2')) = 'pending');
select pg_temp.fails('M5 a manual transfer is refused for the owner',
  $q$select public.owner_submit_payment('monthly',0,'Rina','BCA',current_date,147000,'')$q$, 'permission denied');

reset role;
-- Settlement from the webhook (service role)
select pg_temp.fails('M6 a settlement with another amount is refused',
  format('select public.midtrans_settle(%L, %L, %L, %s)', current_setting('t.o2'), 'trx-1', 'settlement', 1000), 'tidak sesuai');
select pg_temp.ok('M7 a pending notice changes nothing',
  (public.midtrans_settle(current_setting('t.o2'), 'trx-1', 'pending', 1885000)->>'changed')::boolean = false);
select set_config('t.paid', (public.midtrans_settle(current_setting('t.o2'), 'trx-1', 'settlement', 1885000)->>'changed'), false);
select pg_temp.ok('M8 a settlement with the quoted amount activates the plan once',
  current_setting('t.paid') = 'true'
  and (select status from public.payment_confirmations where invoice_number = current_setting('t.o2')) = 'verified'
  and (select plan_code from public.subscriptions where business_id = current_setting('t.b')::uuid) = 'annual');
select pg_temp.ok('M9 a repeated settlement changes nothing',
  (public.midtrans_settle(current_setting('t.o2'), 'trx-1', 'settlement', 1885000)->>'changed')::boolean = false);
select pg_temp.ok('M10 the payment url is saved once for a pending order',
  (select count(*) from (select public.midtrans_save_payment_url(current_setting('t.o1'), 'https://x') ) s) = 1);

-- Admin pages
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.fails('M11 a business owner cannot list every payment',
  $q$select public.admin_list_payments(null, 1)$q$, 'Hanya admin platform');
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', false);
select pg_temp.ok('M12 a platform admin lists payments',
  (public.admin_list_payments(null, 1)->>'total')::int >= 2);
select pg_temp.ok('M13 the admin list filters by status',
  (public.admin_list_payments('verified', 1)->>'total')::int = 1);
reset role;
