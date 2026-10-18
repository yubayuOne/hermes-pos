-- Volume check (not part of run_all.sh, which runs test_0*.sql only). Seeds one outlet with 3 cashiers, 2 shifts each
-- per day for 365 days, 200 bills per shift-day pair (about 220.000 bills, 440.000 items), one expense per shift with
-- 3 items, and one notification per expense. Then times the read RPCs the apps call. Each line: "TIME <ms> <what>".
-- Run on a scratch database only: it inserts directly into tables as superuser.
\set ON_ERROR_STOP on
set client_min_messages = notice;

insert into auth.users(id, email) values ('a0000000-0000-0000-0000-0000000000aa', 'volume@test.id');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000aa', false);
set role authenticated;
select set_config('v.reg', public.register_business('Volume', 'Pusat', null)::text, false);
select set_config('v.b', current_setting('v.reg')::jsonb ->> 'business_id', false);
select set_config('v.o', current_setting('v.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('v.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('v.o')::uuid, 'Kasir ' || n, '123456') from generate_series(1, 3) n;
select set_config('v.p', public.create_product(current_setting('v.o')::uuid, null, 'Kopi susu', 8000, 22000, 1000000)::text, false);
select set_config('v.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Kasir 1'), false);
reset role;

-- Shifts: 3 cashiers x 2 per day x 365 days, closed.
insert into public.shifts(id, cashier_id, outlet_id, opening_cash, shift_number, business_date, opened_at, closed_at, status, closing_cash, expected_cash, variance)
select gen_random_uuid(), cs.cashier_id, current_setting('v.o')::uuid, 100000, s, (current_date - d),
  (current_date - d)::timestamptz + make_interval(hours => 1 + (s - 1) * 8), (current_date - d)::timestamptz + make_interval(hours => 8 + (s - 1) * 8),
  'closed', 100000, 100000, 0
from public.cashier_sessions cs, generate_series(1, 365) d, generate_series(1, 2) s
where cs.outlet_id = current_setting('v.o')::uuid;

-- 100 bills per shift, 2 items each.
insert into public.transactions(id, shift_id, cashier_id, outlet_id, number, status, total, payment_method, created_at)
select gen_random_uuid(), sh.id, sh.cashier_id, sh.outlet_id, 'V-' || sh.id || '-' || n, 'completed', 44000,
  (case when n % 3 = 0 then 'qris' else 'cash' end)::public.payment_method, sh.opened_at + make_interval(mins => n * 4)
from public.shifts sh, generate_series(1, 100) n
where sh.outlet_id = current_setting('v.o')::uuid;
insert into public.transaction_items(transaction_id, product_id, quantity, hpp_unit, selling_price_unit)
select t.id, current_setting('v.p')::uuid, 1, 8000, 22000
from public.transactions t, generate_series(1, 2) where t.outlet_id = current_setting('v.o')::uuid;
insert into public.cash_ledger(shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id, created_at)
select t.shift_id, t.cashier_id, t.outlet_id, 'in', t.total, 'Penjualan', 'payment', t.id, t.created_at
from public.transactions t where t.outlet_id = current_setting('v.o')::uuid and t.payment_method = 'cash';

-- One expense per shift with 3 items, one notification each.
insert into public.expenses(business_id, outlet_id, shift_id, cashier_id, total, created_at)
select current_setting('v.b')::uuid, sh.outlet_id, sh.id, sh.cashier_id, 45000, sh.opened_at + interval '1 hour'
from public.shifts sh where sh.outlet_id = current_setting('v.o')::uuid;
insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount, paid_from)
select e.id, k - 1, 'Barang ' || k, case when k = 1 then 'operasional' else 'belanja' end, 1, 'pcs', 15000, 'drawer'
from public.expenses e, generate_series(1, 3) k where e.business_id = current_setting('v.b')::uuid;
insert into public.notifications(business_id, kind, params, dedupe_key, created_at)
select e.business_id, 'expense', '{}'::jsonb, 'v:' || e.id, e.created_at from public.expenses e where e.business_id = current_setting('v.b')::uuid;
-- Other businesses on the platform (062: an RLS check per row grows with every business's rows): 2.500 trial
-- businesses x 40 products (the trial limit), 100.000 rows.
insert into public.businesses(name) select 'Lain ' || n from generate_series(1, 2500) n;
insert into public.outlets(business_id, name) select id, 'Outlet' from public.businesses where name like 'Lain %';
insert into public.products(outlet_id, name, hpp, selling_price, stock, station)
select o.id, 'Menu ' || k, 1000, 2000, 0, 'bar'
from public.outlets o join public.businesses b on b.id = o.business_id, generate_series(1, 40) k where b.name like 'Lain %';
analyze;

do $$ begin raise notice '%', format('ROWS shifts=%s bills=%s items=%s ledger=%s expenses=%s notifications=%s',
  (select count(*) from public.shifts), (select count(*) from public.transactions), (select count(*) from public.transaction_items),
  (select count(*) from public.cash_ledger), (select count(*) from public.expenses), (select count(*) from public.notifications)); end $$;

create or replace function pg_temp.time(what text, stmt text) returns void language plpgsql as $$
declare t0 timestamptz; r text;
begin
  t0 := clock_timestamp();
  execute stmt into r;
  raise notice '%', format('TIME %s ms  %s  (%s bytes)', round(extract(epoch from clock_timestamp() - t0) * 1000), what, length(r));
end $$;

set role authenticated;
select pg_temp.time('list_outlet_shifts first page', format('select public.list_outlet_shifts(%L, %L)::text', current_setting('v.c'), current_setting('v.o')));
select pg_temp.time('list_outlet_shifts page 30', format('select public.list_outlet_shifts(%L, %L, now() - interval %L)::text', current_setting('v.c'), current_setting('v.o'), '300 days'));
select pg_temp.time('get_shift_report one shift', format('select public.get_shift_report(%L)::text',
  (select id from public.shifts where cashier_id = current_setting('v.c')::uuid order by opened_at desc limit 1)));
select pg_temp.time('list_shift_bills one shift', format('select public.list_shift_bills(%L, %L)::text',
  (select id from public.shifts where cashier_id = current_setting('v.c')::uuid order by opened_at desc limit 1), 'completed'));
select pg_temp.time('owner_list_expenses 30 days', format('select public.owner_list_expenses(null, now() - interval %L)::text', '30 days'));
select pg_temp.time('owner_list_expenses 90 days', format('select public.owner_list_expenses(null, now() - interval %L)::text', '90 days'));
select pg_temp.time('owner_list_bills 30 days page 1', format('select public.owner_list_bills(null, now() - interval %L, now())::text', '30 days'));
select pg_temp.time('owner_report 30 days', format('select public.owner_report(null, now() - interval %L, now(), now() - interval %L, now() - interval %L)::text', '30 days', '60 days', '30 days'));
select pg_temp.time('owner_report 365 days', format('select public.owner_report(null, now() - interval %L, now(), now() - interval %L, now() - interval %L)::text', '365 days', '730 days', '365 days'));
select pg_temp.time('owner_sales_summary 30 days', format('select public.owner_sales_summary(null, now() - interval %L, now(), now() - interval %L, now() - interval %L)::text', '30 days', '60 days', '30 days'));
select pg_temp.time('owner_sales_summary 365 days', format('select public.owner_sales_summary(null, now() - interval %L, now(), now() - interval %L, now() - interval %L)::text', '365 days', '730 days', '365 days'));
select pg_temp.time('list_notifications 30', 'select public.list_notifications(30)::text');

-- 061 to 064. Each new read is timed next to what it replaced.
select pg_temp.time('sidebar: products + vouchers through RLS (before 062)',
  'select ((select count(*) from public.products where not is_temporary) + (select count(*) from public.vouchers))::text');
select pg_temp.time('sidebar: owner_shell_counts (062)', 'select public.owner_shell_counts()::text');
select pg_temp.time('per-row is_owner_of_outlet over all products (028 policy shape)',
  'select count(*)::text from public.products p where public.is_owner_of_outlet(p.outlet_id)');
select pg_temp.time('Ringkasan bulan ini before 062: 3 x owner_summary_with_expenses', format(
  'select public.owner_summary_with_expenses(null, %1$L, now(), %2$L, %1$L)::text || public.owner_summary_with_expenses(null, %3$L, now(), %4$L, %3$L)::text || public.owner_summary_with_expenses(null, %5$L, now(), %6$L, %5$L)::text',
  now() - interval '30 days', now() - interval '60 days', now() - interval '7 days', now() - interval '14 days', now() - interval '1 day', now() - interval '2 days'));
select pg_temp.time('Ringkasan bulan ini: owner_dashboard (062)', format(
  'select public.owner_dashboard(null, %L, now(), %L, %L, %L, %L, now())::text',
  now() - interval '30 days', now() - interval '60 days', now() - interval '30 days', now() - interval '7 days', now() - interval '1 day'));
select pg_temp.time('Ringkasan setahun: owner_dashboard (062)', format(
  'select public.owner_dashboard(null, %L, now(), %L, %L, %L, %L, now())::text',
  now() - interval '365 days', now() - interval '730 days', now() - interval '365 days', now() - interval '7 days', now() - interval '1 day'));
select pg_temp.time('Laporan 30 days before 063: owner_report + owner_sales_summary', format(
  'select public.owner_report(null, %1$L, now(), %2$L, %1$L)::text || public.owner_sales_summary(null, %1$L, now(), %2$L, %1$L)::text',
  now() - interval '30 days', now() - interval '60 days'));
select pg_temp.time('Laporan 30 days: owner_report_page (063)', format(
  'select public.owner_report_page(null, %L, now(), %L, %L)::text', now() - interval '30 days', now() - interval '60 days', now() - interval '30 days'));
select pg_temp.time('Laporan 365 days before 063: owner_report + owner_sales_summary', format(
  'select public.owner_report(null, %1$L, now(), %2$L, %1$L)::text || public.owner_sales_summary(null, %1$L, now(), %2$L, %1$L)::text',
  now() - interval '365 days', now() - interval '730 days'));
select pg_temp.time('Laporan 365 days: owner_report_page (063)', format(
  'select public.owner_report_page(null, %L, now(), %L, %L)::text', now() - interval '365 days', now() - interval '730 days', now() - interval '365 days'));
select pg_temp.time('Produk terjual 30 days: owner_product_sales (061)', format(
  'select public.owner_product_sales(%L, %L, now())::text', current_setting('v.o'), now() - interval '30 days'));
select pg_temp.time('Produk terjual 365 days: owner_product_sales (061)', format(
  'select public.owner_product_sales(%L, %L, now())::text', current_setting('v.o'), now() - interval '365 days'));
select set_config('v.ver', public.pos_reference_snapshot(current_setting('v.o')::uuid, null) ->> 'version', false);
select pg_temp.time('POS catalog snapshot, full', format('select public.pos_reference_snapshot(%L, null)::text', current_setting('v.o')));
select pg_temp.time('POS catalog snapshot, unchanged (063)', format('select public.pos_reference_snapshot(%L, %L)::text', current_setting('v.o'), current_setting('v.ver')));
reset role;
