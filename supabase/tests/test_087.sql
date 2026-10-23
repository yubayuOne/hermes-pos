-- Tests for 087 (the cashier records expenses again; the owner may take them from the drawer). Every line of output must start with PASS.
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
create or replace function pg_temp.item(n text, cat text, amount int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('name', n, 'category', cat, 'quantity', 1, 'unit', 'pcs', 'amount', amount))
$$;
create or replace function pg_temp.rec(paid text, items jsonb, k text) returns jsonb language sql as $$
  select public.record_expense(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid, paid, items, k)
$$;
create or replace function pg_temp.cash() returns numeric language sql security definer as $$
  select (public.get_shift_cash_summary(current_setting('t.sh')::uuid) ->> 'expected_cash')::numeric
$$;
create or replace function pg_temp.items_named(n text) returns bigint language sql security definer as $$
  select count(*) from public.expense_items i join public.expenses e on e.id = i.expense_id where e.shift_id = current_setting('t.sh')::uuid and i.name = n
$$;
create or replace function pg_temp.item_id(n text) returns text language sql security definer as $$
  select i.id::text from public.expense_items i join public.expenses e on e.id = i.expense_id where e.shift_id = current_setting('t.sh')::uuid and i.name = n
$$;
create or replace function pg_temp.shiftcol(col text) returns numeric language plpgsql security definer as $$
declare v numeric;
begin execute format('select %I from public.shifts where id = %L', col, current_setting('t.sh')) into v; return v; end $$;

select pg_temp.ok('S1 signed-in users may call record_expense and the owner path, anonymous clients may not',
  has_function_privilege('authenticated', 'public.record_expense(uuid, uuid, uuid, text, jsonb, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_add_expense_items(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.record_expense(uuid, uuid, uuid, text, jsonb, text)', 'execute')
  and not has_function_privilege('anon', 'public.owner_add_expense_items(uuid, text, jsonb)', 'execute'));

insert into auth.users(id, email) values ('e8700000-0000-0000-0000-000000000001', 'laci@kopi.id'), ('e8700000-0000-0000-0000-000000000002', 'lain3@toko.id');
select set_config('request.jwt.claim.sub', 'e8700000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Laci', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Laci', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Laci'), false);
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 100000)::text, false);

-- The cashier's emergency purchase (review focus 1 and 3).
select set_config('t.a', pg_temp.rec('drawer', pg_temp.item('SKM', 'belanja', 18000), 'k-1')::text, false);
select pg_temp.ok('E1 a drawer expense lowers the expected cash: 100.000 - 18.000', pg_temp.cash() = 82000);
select pg_temp.rec('other', pg_temp.item('Plastik', 'operasional', 15000), 'k-2');
select pg_temp.ok('E2 an expense not from the drawer leaves the cash alone', pg_temp.cash() = 82000);
select pg_temp.rec('drawer', pg_temp.item('SKM', 'belanja', 18000), 'k-1');
select pg_temp.ok('E3 the same key again records once: cash still 82.000, one SKM item',
  pg_temp.cash() = 82000 and pg_temp.items_named('SKM') = 1);

-- The owner adds to the open shift.
select set_config('t.ex', public.owner_add_expense_items(current_setting('t.sh')::uuid, 'drawer', pg_temp.item('Telur', 'belanja', 20000))::text, false);
select pg_temp.ok('O1 an owner drawer expense lowers the cash: 82.000 - 20.000', pg_temp.cash() = 62000);
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other', pg_temp.item('Parkir', 'operasional', 5000));
select pg_temp.ok('O1b the owner path not from the drawer leaves it alone', pg_temp.cash() = 62000);
select pg_temp.fails('O1c an unknown source is refused', format('select public.owner_add_expense_items(%L, %L, %L)',
  current_setting('t.sh'), 'lain', pg_temp.item('X', 'belanja', 1000)), 'Pilih sumber uang');

-- Closing counts against the lowered expected cash.
select public.close_shift(current_setting('t.sh')::uuid, 62000);
select pg_temp.ok('E4 closed with 62.000 counted: expected 62.000, variance 0',
  pg_temp.shiftcol('expected_cash') = 62000 and pg_temp.shiftcol('variance') = 0);

-- Review focus 2: the owner adds a drawer expense to the closed shift.
select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'drawer', pg_temp.item('Gas', 'operasional', 12000));
select pg_temp.ok('O2 on a closed shift the expected cash and the variance are recalculated',
  pg_temp.shiftcol('expected_cash') = 50000 and pg_temp.shiftcol('variance') = 12000);

-- Review focus 4: cancelling a drawer item puts the cash back and the books stay balanced.
select set_config('t.item', pg_temp.item_id('Gas'), false);
select public.owner_cancel_expense_item(current_setting('t.item')::uuid, 'Salah catat');
select pg_temp.ok('C1 cancelling it brings the expected cash back to 62.000 and the variance to 0',
  pg_temp.shiftcol('expected_cash') = 62000 and pg_temp.shiftcol('variance') = 0);
reset role;
select pg_temp.ok('L1 ledger checks are clean after all of it',
  public.ledger_checks(current_setting('t.b')::uuid, current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day') = '[]'::jsonb);

-- Other businesses.
select set_config('request.jwt.claim.sub', 'e8700000-0000-0000-0000-000000000002', false);
set role authenticated;
select public.register_business('Toko Lain Tiga', 'Satu', null);
select pg_temp.fails('X1a another owner cannot add to this shift', format('select public.owner_add_expense_items(%L, %L, %L)',
  current_setting('t.sh'), 'drawer', pg_temp.item('X', 'belanja', 1000)), 'Shift tidak ditemukan');
select pg_temp.fails('X1b another account cannot record into this shift', format('select public.record_expense(%L, %L, %L, %L, %L, %L)',
  current_setting('t.sh'), current_setting('t.c'), current_setting('t.o'), 'drawer', pg_temp.item('X', 'belanja', 1000), 'x-9'), '');
reset role;
select pg_temp.ok('X2 nothing was added by them', pg_temp.items_named('X') = 0);
