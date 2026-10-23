-- Tests for 077 (cashier without expenses; owner expenses never touch the drawer) on top of 001 to 077.
-- 087 reversed the decision on 23 Oct 2026: the cashier records expenses again and the owner may take them from the drawer
-- (test_087). What stays true from 077 is kept here: an expense paid outside the drawer leaves the cash alone, and old
-- drawer expenses keep their cash book rows and can still be cancelled. Every line of output must start with PASS.
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
create or replace function pg_temp.cash() returns numeric language sql as $$
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) from public.cash_ledger where shift_id = current_setting('t.sh')::uuid
$$;
create or replace function pg_temp.items(amount int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('name', 'Listrik', 'category', 'operasional', 'quantity', 1, 'unit', 'pcs', 'amount', amount))
$$;

select pg_temp.ok('S1 the owner path is granted to signed-in users and not to anonymous clients',
  has_function_privilege('authenticated', 'public.owner_add_expense_items(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.owner_add_expense_items(uuid, text, jsonb)', 'execute'));

insert into auth.users(id, email) values ('e7700000-0000-0000-0000-000000000001', 'sari@kopi.id');
select set_config('request.jwt.claim.sub', 'e7700000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Sari', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Sari', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Sari'), false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);

select set_config('t.ex', public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', pg_temp.items(50000))::text, false);
select pg_temp.ok('A3 an owner expense paid outside the drawer is recorded and the expected cash stays 100.000',
  (current_setting('t.ex')::jsonb ->> 'total')::numeric = 50000 and pg_temp.cash() = 100000);

select public.close_shift(current_setting('t.sh')::uuid, 100000);
select pg_temp.ok('C1 closed with the opening cash counted: expected 100.000, variance 0',
  (select expected_cash from public.shifts where id = current_setting('t.sh')::uuid) = 100000
  and (select variance from public.shifts where id = current_setting('t.sh')::uuid) = 0);

-- A drawer expense recorded before 077 keeps its cash book row, and cancelling it still reverses that row.
set role authenticated;
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);
reset role;
insert into public.expenses(business_id, outlet_id, shift_id, cashier_id, total, entry_keys)
values (current_setting('t.b')::uuid, current_setting('t.o')::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid, 0, '{}');
insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount, paid_from)
select id, 0, 'Gula', 'belanja', 1, 'kg', 30000, 'drawer' from public.expenses where shift_id = current_setting('t.sh')::uuid;
select public._073_sync_expense((select id from public.expenses where shift_id = current_setting('t.sh')::uuid));
select pg_temp.ok('L1 old drawer expense: expected cash 70.000', pg_temp.cash() = 70000);
select set_config('t.item', (select i.id::text from public.expense_items i join public.expenses e on e.id = i.expense_id
  where e.shift_id = current_setting('t.sh')::uuid and i.name = 'Gula'), false);
set role authenticated;
select public.owner_cancel_expense_item(current_setting('t.item')::uuid, 'Salah catat');
select pg_temp.ok('L2 cancelling it puts the 30.000 back: expected cash 100.000', pg_temp.cash() = 100000);
reset role;
select pg_temp.ok('L3 ledger checks stay clean',
  public.ledger_checks(current_setting('t.b')::uuid, current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day') = '[]'::jsonb);
