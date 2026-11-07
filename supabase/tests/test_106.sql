-- Tests for 106 (Stock Opname of barang). Every line of output must start with PASS.
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
-- The day row of a barang in the sheet of one day.
create or replace function pg_temp.row(p_outlet uuid, p_date date, p_name text) returns jsonb language sql as $$
  select e.value from jsonb_array_elements(public.owner_list_stock_opname(p_outlet, p_date)) as e(value) where e.value ->> 'name' = p_name
$$;

insert into auth.users(id, email) values ('10600000-0000-0000-0000-000000000001', 'pemilik@opname.id'), ('10600000-0000-0000-0000-000000000002', 'lain@opname.id');
select set_config('request.jwt.claim.sub', '10600000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Warung Opname', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
select set_config('t.gula', public.owner_save_barang(current_setting('t.o')::uuid, null, 'Gula', 'g', true)::text, false);
select set_config('t.listrik', public.owner_save_barang(current_setting('t.o')::uuid, null, 'Listrik', 'pcs', false)::text, false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;

-- Dates: d1 two days ago (first count), d2 yesterday, d3 today. Expense moves are written directly, as the owner's
-- expenses would write them (kind expense, positive qty).
select set_config('t.d1', (current_date - 2)::text, false);
select set_config('t.d2', (current_date - 1)::text, false);
select set_config('t.d3', current_date::text, false);
insert into public.ingredient_moves(ingredient_id, outlet_id, kind, qty, at)
values (current_setting('t.gula')::uuid, current_setting('t.o')::uuid, 'expense', 5, (current_setting('t.d2')::date + interval '12 hours') at time zone 'Asia/Jakarta');

set role authenticated;
select set_config('request.jwt.claim.sub', '10600000-0000-0000-0000-000000000001', false);

select pg_temp.fails('O1 the first count needs the opening stock',
  format('select public.owner_save_stock_opname(%L, %L, %L::jsonb)', current_setting('t.o'), current_setting('t.d1'),
    format('[{"ingredientId":"%s","out":2,"closing":7}]', current_setting('t.gula'))),
  'Stok awal Gula');
select pg_temp.ok('O2 the first count saves with its opening stock',
  public.owner_save_stock_opname(current_setting('t.o')::uuid, current_setting('t.d1')::date,
    format('[{"ingredientId":"%s","opening":10,"out":2,"closing":7,"note":"tumpah"}]', current_setting('t.gula'))::jsonb) = 1);
select pg_temp.ok('O3 the first day: opening 10, out 2, closing 7, difference -1 (the spill)',
  (pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d1')::date, 'Gula') ->> 'opening')::numeric = 10
  and (pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d1')::date, 'Gula') ->> 'difference')::numeric = -1
  and pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d1')::date, 'Gula') ->> 'note' = 'tumpah');
select pg_temp.ok('O4 the next day opens with the closing of the day before, and shows the expense moves in',
  (pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d2')::date, 'Gula') ->> 'opening')::numeric = 7
  and (pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d2')::date, 'Gula') ->> 'incoming')::numeric = 5
  and (pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d2')::date, 'Gula') ->> 'openingEditable')::boolean = false);
select pg_temp.ok('O5 a day not counted yet has no closing and no difference',
  pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d2')::date, 'Gula') ->> 'closing' is null
  and pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d2')::date, 'Gula') ->> 'difference' is null);
select pg_temp.ok('O6 counting the next day: 7 + 5 - 1 = 11 expected, 10 counted, difference -1',
  public.owner_save_stock_opname(current_setting('t.o')::uuid, current_setting('t.d2')::date,
    format('[{"ingredientId":"%s","out":1,"closing":10}]', current_setting('t.gula'))::jsonb) = 1
  and (pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d2')::date, 'Gula') ->> 'difference')::numeric = -1);
select pg_temp.ok('O7 the third day opens with 10, no moves, and counts through a skipped day',
  (pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d3')::date, 'Gula') ->> 'opening')::numeric = 10
  and (pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d3')::date, 'Gula') ->> 'incoming')::numeric = 0);
select pg_temp.fails('O8 a negative closing count is refused',
  format('select public.owner_save_stock_opname(%L, %L, %L::jsonb)', current_setting('t.o'), current_setting('t.d3'),
    format('[{"ingredientId":"%s","closing":-1}]', current_setting('t.gula'))), 'Stok akhir Gula');
select pg_temp.fails('O9 a negative out is refused',
  format('select public.owner_save_stock_opname(%L, %L, %L::jsonb)', current_setting('t.o'), current_setting('t.d3'),
    format('[{"ingredientId":"%s","out":-2,"closing":5}]', current_setting('t.gula'))), 'Stok keluar Gula');
select pg_temp.fails('O10 a future day is refused',
  format('select public.owner_list_stock_opname(%L, %L)', current_setting('t.o'), (current_date + 1)::text), 'masa depan');
select pg_temp.ok('O11 a barang that is not counted is not on the sheet',
  pg_temp.row(current_setting('t.o')::uuid, current_setting('t.d3')::date, 'Listrik') is null);
select pg_temp.fails('O12 a barang that is not counted cannot be saved',
  format('select public.owner_save_stock_opname(%L, %L, %L::jsonb)', current_setting('t.o'), current_setting('t.d3'),
    format('[{"ingredientId":"%s","closing":3}]', current_setting('t.listrik'))), 'Barang tidak ditemukan');

select set_config('request.jwt.claim.sub', '10600000-0000-0000-0000-000000000002', false);
select pg_temp.fails('O13 another owner cannot see this outlet',
  format('select public.owner_list_stock_opname(%L, %L)', current_setting('t.o'), current_setting('t.d3')), 'Outlet tidak ditemukan');
