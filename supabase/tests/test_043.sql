-- Tests for 043 (expenses count at once, owner edits, shift history and refund lists for the POS) on top of 001 to 077 (expenses are recorded by the owner, never from the drawer).
-- Every line of output must start with PASS.
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
create or replace function pg_temp.pay(qty int, k text) returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', current_setting('t.kopi'), 'quantity', qty))),
    'cash', 1000000, null, k, null, null) ->> 'transactionId')::uuid
$$;
create or replace function pg_temp.it(name text, amount int, paid text default null) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'category', 'belanja', 'quantity', 1, 'unit', 'pcs', 'amount', amount)
    || case when paid is null then '{}'::jsonb else jsonb_build_object('paidFrom', paid) end
$$;
create or replace function pg_temp.rec(k text) returns jsonb language sql as $$
  select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', jsonb_build_array(pg_temp.it('Gula pasir', 30000)))
$$;
create or replace function pg_temp.cash() returns numeric language sql as $$
  select (public.get_shift_cash_summary(current_setting('t.sh')::uuid) ->> 'expected_cash')::numeric
$$;
create or replace function pg_temp.shifts() returns jsonb language sql as $$
  select public.list_outlet_shifts(current_setting('t.c')::uuid, current_setting('t.o')::uuid)
$$;

insert into auth.users(id, email) values ('f0000000-0000-0000-0000-000000000001', 'tia@warung.id'), ('f0000000-0000-0000-0000-000000000002', 'budi@lain.id');
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Warung Tia', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Tia', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Tia'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);

-- A: 2 kopi 44.000. B: 1 kopi 22.000, refunded in cash. Expense: gula 30.000, not from the drawer.
select pg_temp.pay(2, 'p-a');
select set_config('t.bb', pg_temp.pay(1, 'p-b')::text, false);
select public.refund_items_approved(current_setting('t.bb')::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting('t.bb')::uuid), 'quantity', 1, 'restock', false)),
  'cash', 'Salah pesan', '271828', 'r-1');
select set_config('t.ex', pg_temp.rec('k-1') ->> 'id', false);
select pg_temp.ok('E1 expected cash: 100.000 + 66.000 - 22.000 = 144.000, the expense does not count', pg_temp.cash() = 144000);

select set_config('t.l', pg_temp.shifts()::text, false);
select pg_temp.ok('L1 shift history: 1 open shift, cashier Tia, sales net of refunds 44.000, expenses 30.000',
  jsonb_array_length(current_setting('t.l')::jsonb) = 1 and current_setting('t.l')::jsonb -> 0 ->> 'status' = 'open'
  and current_setting('t.l')::jsonb -> 0 ->> 'cashierName' = 'Tia'
  and (current_setting('t.l')::jsonb -> 0 ->> 'sales')::numeric = 44000 and (current_setting('t.l')::jsonb -> 0 ->> 'expenses')::numeric = 30000);
select pg_temp.ok('L2 sales match the shift report total',
  (current_setting('t.l')::jsonb -> 0 ->> 'sales')::numeric = (public.get_shift_report(current_setting('t.sh')::uuid) ->> 'totalRevenue')::numeric);
select pg_temp.ok('R1 shift refunds: reason, bill number, item, amount',
  public.list_shift_refunds(current_setting('t.sh')::uuid) -> 0 ->> 'reason' = 'Salah pesan'
  and public.list_shift_refunds(current_setting('t.sh')::uuid) -> 0 ->> 'number' like '%HPOS%'
  and public.list_shift_refunds(current_setting('t.sh')::uuid) -> 0 -> 'items' -> 0 ->> 'productName' = 'Kopi susu'
  and (public.list_shift_refunds(current_setting('t.sh')::uuid) -> 0 ->> 'amount')::numeric = 22000);
select pg_temp.ok('R2 bill refunds carry the reason', public.list_bill_refunds(current_setting('t.bb')::uuid) -> 0 ->> 'reason' = 'Salah pesan'
  and jsonb_array_length(public.list_bill_refunds(current_setting('t.bb')::uuid)) = 1);

select set_config('t.list', public.owner_list_expenses()::text, false);
select pg_temp.ok('O1 owner sees the expense at once, no status, totals 30.000',
  jsonb_array_length(current_setting('t.list')::jsonb -> 'rows') = 1 and current_setting('t.list')::jsonb -> 'rows' -> 0 -> 'status' is null
  and (current_setting('t.list')::jsonb -> 'totals' ->> 'total')::numeric = 30000 and (current_setting('t.list')::jsonb -> 'totals' ->> 'belanja')::numeric = 30000);

-- The owner's expense edit (043) was replaced by balancing in 071; see test_071.
select set_config('t.k2', pg_temp.rec('k-2')::text, false);
select pg_temp.ok('K1 a new entry adds to the shift''s record: total 60.000, nothing from the drawer, expected cash 144.000',
  (current_setting('t.k2')::jsonb ->> 'total')::numeric = 60000 and (current_setting('t.k2')::jsonb ->> 'drawerTotal')::numeric = 0 and pg_temp.cash() = 144000);
select pg_temp.ok('C1 close: counted 144.000, variance 0', (public.close_shift(current_setting('t.sh')::uuid, 144000) ->> 'variance')::numeric = 0);
reset role;
select pg_temp.ok('C3 no cash book row for the expenses',
  (select count(*) from public.cash_ledger where source_type = 'expense' and shift_id = current_setting('t.sh')::uuid) = 0);
update public.shifts set opened_at = opened_at - interval '1 hour' where id = current_setting('t.sh')::uuid;
set role authenticated;

select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
select pg_temp.ok('L3 history: newest first, open and closed', jsonb_array_length(pg_temp.shifts()) = 2
  and pg_temp.shifts() -> 0 ->> 'status' = 'open' and pg_temp.shifts() -> 1 ->> 'status' = 'closed'
  and (pg_temp.shifts() -> 0 ->> 'sales')::numeric = 0 and (pg_temp.shifts() -> 0 ->> 'expenses')::numeric = 0);
select pg_temp.ok('L4 next page starts before the last row', jsonb_array_length(public.list_outlet_shifts(current_setting('t.c')::uuid,
  current_setting('t.o')::uuid, (pg_temp.shifts() -> 0 ->> 'openedAt')::timestamptz, 30)) = 1);
select pg_temp.ok('L5 empty shift: no refunds', public.list_shift_refunds(current_setting('t.sh')::uuid) = '[]'::jsonb);

-- Another business cannot see, edit, or list any of it.
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Budi', 'Satu', null);
select pg_temp.ok('X1 other owner sees no expenses', jsonb_array_length(public.owner_list_expenses() -> 'rows') = 0);
select pg_temp.fails('X3 other account cannot list the shifts', 'select pg_temp.shifts()', 'Sesi kasir tidak valid');
select pg_temp.fails('X4 other account cannot read the refunds', format('select public.list_bill_refunds(%L)', current_setting('t.bb')), 'Sesi kasir tidak valid');
reset role;
