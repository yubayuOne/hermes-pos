-- Tests for 096 (stock count sheet: a count for any day, the sheet columns, the old count path closed).
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
create or replace function pg_temp.line(pid text, q numeric) returns jsonb language sql as $$
  select jsonb_build_object('productId', current_setting(pid), 'qty', q)
$$;
create or replace function pg_temp.row(pid text, counted numeric, opening numeric default null, received numeric default null,
  issued numeric default null, note text default null) returns jsonb language sql as $$
  select jsonb_build_object('productId', current_setting(pid), 'counted', counted, 'opening', opening, 'received', received,
    'issued', issued, 'note', note)
$$;
create or replace function pg_temp.sheet(p_date date, lines jsonb) returns jsonb language sql as $$
  select public.owner_stock_opname_sheet(current_setting('t.o')::uuid, lines, p_date)
$$;
create or replace function pg_temp.stock(pid text) returns numeric language sql as $$
  select stock from public.products where id = current_setting(pid)::uuid
$$;
create or replace function pg_temp.sheetline(doc jsonb, pid text) returns jsonb language sql as $$
  select l from jsonb_array_elements(doc -> 'lines') l where l ->> 'productId' = current_setting(pid) limit 1
$$;

insert into auth.users(id, email) values ('96000000-0000-0000-0000-000000000001', 'mira@warmiko.id'), ('96000000-0000-0000-0000-000000000002', 'nina@lain.id');
select set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Warmiko Test', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 50)::text, false);
select set_config('t.teh', public.create_product(current_setting('t.o')::uuid, null, 'Teh racik', 3000, 10000, 10)::text, false);
-- Two days back is the day under test. Movements are dated on it, so the count of that day sees them.
select set_config('t.d2', ((now() at time zone 'Asia/Jakarta')::date - 2)::text, false);
select set_config('t.in', public.owner_stock_document(current_setting('t.o')::uuid, 'stock_in', 'Kiriman pemasok',
  jsonb_build_array(pg_temp.line('t.kopi', 30)))::text, false);
select set_config('t.adj', public.owner_stock_document(current_setting('t.o')::uuid, 'adjustment', 'Rusak',
  jsonb_build_array(pg_temp.line('t.kopi', -3)))::text, false);
select set_config('t.adj2', public.owner_stock_document(current_setting('t.o')::uuid, 'adjustment', 'Habis dipakai',
  jsonb_build_array(pg_temp.line('t.teh', -10)))::text, false);
reset role;
update public.stock_documents set created_at = (current_setting('t.d2')::date - 1 + time '08:00') at time zone 'Asia/Jakarta'
  where outlet_id = current_setting('t.o')::uuid and kind = 'initial';
update public.stock_documents set created_at = (current_setting('t.d2')::date + time '08:00') at time zone 'Asia/Jakarta'
  where id = (current_setting('t.in')::jsonb ->> 'id')::uuid;
update public.stock_documents set created_at = (current_setting('t.d2')::date + time '15:00') at time zone 'Asia/Jakarta'
  where id = (current_setting('t.adj')::jsonb ->> 'id')::uuid;
set role authenticated;
-- Kopi: 50 + 30 - 3 = 77 on the day under test. Teh: 10 - 10 = 0 now, 10 on that day.

select pg_temp.ok('G1 only owners reach the count sheet: no table access, no anon, the book helper is internal',
  not has_table_privilege('authenticated', 'public.stock_documents', 'select')
  and has_function_privilege('authenticated', 'public.owner_stock_opname_sheet(uuid, jsonb, date)', 'execute')
  and not has_function_privilege('anon', 'public.owner_stock_opname_sheet(uuid, jsonb, date)', 'execute')
  and not has_function_privilege('anon', 'public.owner_stock_openings(uuid, date)', 'execute')
  and not has_function_privilege('authenticated', 'public.stock_book_at(uuid, timestamptz)', 'execute'));
select pg_temp.ok('O0 before any count the opening of kopi is unknown (null), so the admin types it',
  (select e -> 'opening' = 'null'::jsonb from jsonb_array_elements(public.owner_stock_openings(current_setting('t.o')::uuid, current_setting('t.d2')::date)) e
   where e ->> 'id' = current_setting('t.kopi')));

-- ===== a count for a past day
select set_config('t.s1', pg_temp.sheet(current_setting('t.d2')::date, jsonb_build_array(pg_temp.row('t.kopi', 75, 70, 30, 3, 'Hitung sore')))::text, false);
select pg_temp.ok('S1 the past day: book 77 at its end, count 75, booked -2, the typed opening 70 is kept (never counted before)',
  pg_temp.stock('t.kopi') = 75
  and (pg_temp.sheetline(current_setting('t.s1')::jsonb, 't.kopi') ->> 'qty')::numeric = -2
  and (pg_temp.sheetline(current_setting('t.s1')::jsonb, 't.kopi') ->> 'bookQty')::numeric = 77
  and (pg_temp.sheetline(current_setting('t.s1')::jsonb, 't.kopi') ->> 'opening')::numeric = 70
  and (pg_temp.sheetline(current_setting('t.s1')::jsonb, 't.kopi') ->> 'received')::numeric = 30
  and (pg_temp.sheetline(current_setting('t.s1')::jsonb, 't.kopi') ->> 'issued')::numeric = 3
  and (pg_temp.sheetline(current_setting('t.s1')::jsonb, 't.kopi') ->> 'variance')::numeric = -22
  and pg_temp.sheetline(current_setting('t.s1')::jsonb, 't.kopi') ->> 'note' = 'Hitung sore');

-- ===== a movement after the past count is kept on top of it
select public.owner_stock_document(current_setting('t.o')::uuid, 'stock_in', 'Titip toko lain', jsonb_build_array(pg_temp.line('t.kopi', 5)));

-- ===== today's count: the earlier count is the opening, a typed opening is ignored
select set_config('t.s2', pg_temp.sheet(null, jsonb_build_array(pg_temp.row('t.kopi', 80, 999)))::text, false);
select pg_temp.ok('S2 today: the opening is the count of the past day (75), the typed 999 is ignored; the book has the later +5, so the difference is 0',
  pg_temp.stock('t.kopi') = 80
  and (pg_temp.sheetline(current_setting('t.s2')::jsonb, 't.kopi') ->> 'opening')::numeric = 75
  and (pg_temp.sheetline(current_setting('t.s2')::jsonb, 't.kopi') ->> 'bookQty')::numeric = 80
  and (pg_temp.sheetline(current_setting('t.s2')::jsonb, 't.kopi') ->> 'qty')::numeric = 0);
select pg_temp.ok('O1 the openings for today: kopi 75 (the count before today)',
  (select (e ->> 'opening')::numeric = 75 from jsonb_array_elements(public.owner_stock_openings(current_setting('t.o')::uuid, null)) e
   where e ->> 'id' = current_setting('t.kopi')));

-- ===== refusals
select pg_temp.fails('R1 a count of an earlier day is refused when the product has a later count',
  $q$select pg_temp.sheet(current_setting('t.d2')::date - 1, jsonb_build_array(pg_temp.row('t.kopi', 60)))$q$, 'setelah tanggal ini');
select pg_temp.fails('R2 a date after today is refused',
  $q$select pg_temp.sheet((now() at time zone 'Asia/Jakarta')::date + 1, jsonb_build_array(pg_temp.row('t.kopi', 60)))$q$, 'tidak boleh setelah hari ini');
select set_config('t.n0', (public.owner_list_stock_documents(current_setting('t.o')::uuid, now() - interval '399 days', now() + interval '1 day') ->> 'total'), false);
select pg_temp.fails('R3 a past count that leaves today negative is refused: teh 10 on that day, 0 today',
  $q$select pg_temp.sheet(current_setting('t.d2')::date, jsonb_build_array(pg_temp.row('t.teh', 0)))$q$, 'Stok Teh racik tidak cukup');
select pg_temp.ok('R4 nothing is saved by the refused count: teh still 0, no new document',
  pg_temp.stock('t.teh') = 0
  and (public.owner_list_stock_documents(current_setting('t.o')::uuid, now() - interval '399 days', now() + interval '1 day') ->> 'total') = current_setting('t.n0'));
select pg_temp.fails('R5 a negative received is refused', $q$select pg_temp.sheet(null, jsonb_build_array(pg_temp.row('t.teh', 2, null, -1)))$q$, 'tidak valid');
select pg_temp.fails('R5b a negative issued is refused', $q$select pg_temp.sheet(null, jsonb_build_array(pg_temp.row('t.teh', 2, null, null, -1)))$q$, 'tidak valid');
select pg_temp.fails('R5c a negative opening is refused', $q$select pg_temp.sheet(null, jsonb_build_array(pg_temp.row('t.teh', 2, -1)))$q$, 'tidak valid');
select pg_temp.fails('R6 a note over 200 characters is refused', $q$select pg_temp.sheet(null, jsonb_build_array(pg_temp.row('t.teh', 2, null, null, null, repeat('x', 201))))$q$, 'tidak valid');
select pg_temp.fails('R7 a sheet with no count is refused', $q$select pg_temp.sheet(null, jsonb_build_array(jsonb_build_object('productId', current_setting('t.teh'), 'counted', null)))$q$, 'hasil hitung minimal satu');
select pg_temp.fails('R8 one product once per sheet', $q$select pg_temp.sheet(null, jsonb_build_array(pg_temp.row('t.teh', 2), pg_temp.row('t.teh', 3)))$q$, 'sekali');
select pg_temp.fails('R9 the count path for opname is closed; the sheet is the only way',
  $q$select public.owner_stock_document(current_setting('t.o')::uuid, 'opname', '', jsonb_build_array(pg_temp.line('t.kopi', 1)))$q$, 'lembar hitung');

-- ===== another business
select set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Nina', 'Satu', null);
select pg_temp.fails('N1 another business cannot read the openings of this outlet',
  $q$select public.owner_stock_openings(current_setting('t.o')::uuid, null)$q$, 'tidak ditemukan');
select pg_temp.fails('N2 nor save a count into it',
  $q$select public.owner_stock_opname_sheet(current_setting('t.o')::uuid, jsonb_build_array(pg_temp.row('t.kopi', 1)), null)$q$, 'tidak ditemukan');
select set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000001', false);

-- ===== the books
reset role;
select pg_temp.ok('D1 the past-day count is dated at its last microsecond, in the business time zone',
  (select created_at from public.stock_documents where id = (current_setting('t.s1')::jsonb ->> 'id')::uuid)
  = ((current_setting('t.d2')::date + 1)::timestamp - interval '1 microsecond') at time zone 'Asia/Jakarta');
select pg_temp.ok('P1 the books agree: the stock book equals the stock of every tracked product',
  not exists (select 1 from public.stock_book(current_setting('t.b')::uuid, current_setting('t.o')::uuid) x
              join public.products p on p.id = x.product_id where x.book <> p.stock)
  and pg_temp.stock('t.kopi') = 80 and pg_temp.stock('t.teh') = 0);
