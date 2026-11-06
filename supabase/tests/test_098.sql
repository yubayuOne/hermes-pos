-- Tests for 098 (owner_report_detail: bills, menu portions and values, approved expenses). Every line of output must start with PASS.
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
create or replace function pg_temp.bill(o text, s text, c text, num text, at timestamptz, total numeric, method text, cust text, status text default 'completed')
returns uuid language plpgsql as $$
declare id uuid;
begin
  insert into public.transactions(shift_id, cashier_id, outlet_id, number, status, total, subtotal, payment_method, customer_name, created_at, completed_at)
  values (current_setting(s)::uuid, current_setting(c)::uuid, current_setting(o)::uuid, num, status::public.order_status, total, total, method::public.payment_method, cust, at, at)
  returning transactions.id into id;
  return id;
end $$;

insert into auth.users(id, email) values ('98000000-0000-0000-0000-000000000001', 'mira@kopi.id'), ('98000000-0000-0000-0000-000000000002', 'nina@toko.id');

-- Mira: one business with two outlets, each with a cashier and an open shift.
select set_config('request.jwt.claim.sub', '98000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.regA', public.register_business('Kopi Mira', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.regA')::jsonb ->> 'business_id', false);
select set_config('t.o1', current_setting('t.regA')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days', extra_outlets = 1 where business_id = current_setting('t.b')::uuid;
set role authenticated;
select set_config('t.o2', public.owner_create_outlet('Cabang Dua')::text, false);
select public.owner_create_cashier(current_setting('t.o1')::uuid, 'Mira', '123456');
select public.owner_create_cashier(current_setting('t.o2')::uuid, 'Dua', '654321');
select set_config('t.c1', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Mira'), false);
select set_config('t.c2', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Dua'), false);
select public.owner_set_void_code('271828');
select set_config('t.s1', public.open_shift(current_setting('t.c1')::uuid, current_setting('t.o1')::uuid, 0)::text, false);
select set_config('t.s2', public.open_shift(current_setting('t.c2')::uuid, current_setting('t.o2')::uuid, 0)::text, false);
select set_config('t.kopi1', public.create_product(current_setting('t.o1')::uuid, null, 'Kopi susu', 8000, 22000, 0)::text, false);
select set_config('t.kopi2', public.create_product(current_setting('t.o2')::uuid, null, 'kopi susu ', 8000, 22000, 0)::text, false);

-- Nina: another business, with no outlet of Mira's.
select set_config('request.jwt.claim.sub', '98000000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Nina', 'Satu', null);
reset role;

-- Sales on 3 Nov 2026 (Jakarta): outlet 1 at 10:15 cash, outlet 2 at 19:30 qris, a free bill, a void, a pending one.
select set_config('t.b1', pg_temp.bill('t.o1', 't.s1', 't.c1', '#HPOS-20261103-A1-0001', '2026-11-03 03:15+00', 44000, 'cash', 'Budi')::text, false);
select set_config('t.b2', pg_temp.bill('t.o2', 't.s2', 't.c2', '#HPOS-20261103-A1-0001', '2026-11-03 12:30+00', 22000, 'qris', 'umum')::text, false);
select set_config('t.b3', pg_temp.bill('t.o1', 't.s1', 't.c1', '#HPOS-20261103-A1-0002', '2026-11-03 03:40+00', 0, 'cash', 'Tamu')::text, false);
select pg_temp.bill('t.o1', 't.s1', 't.c1', '#HPOS-20261103-A1-0003', '2026-11-03 04:00+00', 22000, 'cash', 'Sari', 'voided');
select pg_temp.bill('t.o1', 't.s1', 't.c1', '#HPOS-20261103-A1-0004', '2026-11-03 04:10+00', 22000, 'cash', 'Sari', 'cancelled');
insert into public.transaction_items(transaction_id, product_id, quantity, hpp_unit, selling_price_unit)
values (current_setting('t.b1')::uuid, current_setting('t.kopi1')::uuid, 2, 8000, 22000),
       (current_setting('t.b2')::uuid, current_setting('t.kopi2')::uuid, 1, 8000, 22000),
       (current_setting('t.b3')::uuid, current_setting('t.kopi1')::uuid, 3, 8000, 22000);

-- The shifts belong to 3 Nov 2026 (the business day), so the expenses of them count on that day.
update public.shifts set business_date = '2026-11-03' where id in (current_setting('t.s1')::uuid, current_setting('t.s2')::uuid);
-- Expenses of the shift (one row per shift, 041): two items, an operasional one from the drawer and a belanja one.
insert into public.expenses(business_id, outlet_id, shift_id, cashier_id, total, created_at)
values (current_setting('t.b')::uuid, current_setting('t.o1')::uuid, current_setting('t.s1')::uuid, current_setting('t.c1')::uuid, 24000, '2026-11-03 05:00+00');
insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount, paid_from)
select e.id, 1, 'Es batu', 'operasional', 2, 'kg', 15000, 'drawer' from public.expenses e where e.shift_id = current_setting('t.s1')::uuid
union all select e.id, 2, 'Susu UHT', 'belanja', 3, 'L', 9000, 'other' from public.expenses e where e.shift_id = current_setting('t.s1')::uuid;

select set_config('request.jwt.claim.sub', '98000000-0000-0000-0000-000000000001', false);
set role authenticated;

select pg_temp.ok('G1 only owners reach the detail; anon cannot call it',
  has_function_privilege('authenticated', 'public.owner_report_detail(uuid, timestamptz, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.owner_report_detail(uuid, timestamptz, timestamptz)', 'execute'));

select pg_temp.ok('B1 bills: only completed ones, free bill included, local time 10:15 for the 03:15 UTC bill',
  (public.owner_report_detail(null, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'bills') @> '[["2026-11-03T10:15", 44000, "cash", "Budi", 44000]]'::jsonb
  and (public.owner_report_detail(null, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'bills') @> '[["2026-11-03T10:40", 0, "cash", "Tamu", 0]]'::jsonb
  and jsonb_array_length(public.owner_report_detail(null, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'bills') = 3);

select pg_temp.ok('I1 items: portions and menu value, the free bill counted; the same menu from two outlets is one row',
  (select (x ->> 2)::numeric = 6 and (x ->> 3)::numeric = 132000
   from jsonb_array_elements(public.owner_report_detail(null, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'items') x
   where lower(x ->> 1) = 'kopi susu'));
select pg_temp.ok('I2 a single outlet gives only its own menu rows',
  (select (x ->> 2)::numeric = 5 from jsonb_array_elements(public.owner_report_detail(current_setting('t.o1')::uuid, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'items') x
   where lower(x ->> 1) = 'kopi susu'));

select pg_temp.ok('E1 expenses: each item with its shift day, category, and paid-from',
  (public.owner_report_detail(null, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'expenses') @> '[["2026-11-03", "operasional", "Es batu", 2, "kg", 15000, "drawer"], ["2026-11-03", "belanja", "Susu UHT", 3, "L", 9000, "other"]]'::jsonb
  and jsonb_array_length(public.owner_report_detail(null, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'expenses') = 2);

select pg_temp.ok('O1 every outlet of the business when no outlet is given',
  jsonb_array_length(public.owner_report_detail(null, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'bills') = 3
  and exists (select 1 from jsonb_array_elements(public.owner_report_detail(null, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'bills') x where x ->> 3 = 'Budi'));

select pg_temp.fails('R1 a range longer than 400 days is refused', $q$select public.owner_report_detail(null, '2025-01-01', '2026-11-03')$q$, 'terlalu panjang');
select pg_temp.fails('R2 an empty or reversed range is refused', $q$select public.owner_report_detail(null, '2026-11-03', '2026-11-03')$q$, 'tidak valid');

-- Another owner sees nothing of this business.
select set_config('request.jwt.claim.sub', '98000000-0000-0000-0000-000000000002', false);
select pg_temp.ok('N1 another business sees no bills, items, or expenses',
  (public.owner_report_detail(null, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'bills') = '[]'::jsonb
  and (public.owner_report_detail(null, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'items') = '[]'::jsonb
  and (public.owner_report_detail(null, '2026-11-02 17:00+00', '2026-11-03 17:00+00') -> 'expenses') = '[]'::jsonb);
select pg_temp.fails('R3 another business outlet is refused', $q$select public.owner_report_detail(current_setting('t.o1')::uuid, '2026-11-02', '2026-11-04')$q$, 'tidak ditemukan');
reset role;
