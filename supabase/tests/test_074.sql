-- Tests for 074 (stock documents, stock book, P7) on top of 001 to the latest migration.
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
create or replace function pg_temp.pay(pid text, q int, k text) returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', current_setting(pid), 'quantity', q))),
    'cash', 1000000, null, k, null, null) ->> 'transactionId')::uuid
$$;
create or replace function pg_temp.doc(kind text, lines jsonb, reason text default '') returns jsonb language sql as $$
  select public.owner_stock_document(current_setting('t.o')::uuid, kind, reason, lines)
$$;
create or replace function pg_temp.line(pid text, q numeric) returns jsonb language sql as $$
  select jsonb_build_object('productId', current_setting(pid), 'qty', q)
$$;
create or replace function pg_temp.stock(pid text) returns numeric language sql as $$
  select stock from public.products where id = current_setting(pid)::uuid
$$;
create or replace function pg_temp.p7() returns jsonb language sql as $$
  select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(
    public.owner_day_close(current_setting('t.o')::uuid, (now() at time zone 'Asia/Jakarta')::date) -> 'checks') f
  where f ->> 'rule' = 'P7'
$$;

select pg_temp.ok('S1 stock records are internal; owners call the functions',
  not has_table_privilege('authenticated', 'public.stock_documents', 'select') and not has_table_privilege('authenticated', 'public.stock_moves', 'select')
  and has_function_privilege('authenticated', 'public.owner_stock_document(uuid, text, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.owner_stock_document(uuid, text, text, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_list_stock(uuid)', 'execute'));

insert into auth.users(id, email) values ('e7400000-0000-0000-0000-000000000001', 'mira@kopi.id'), ('e7400000-0000-0000-0000-000000000002', 'nina@lain.id');
select set_config('request.jwt.claim.sub', 'e7400000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Mira', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Mira', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Mira'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 50)::text, false);
select set_config('t.roti', public.create_product(current_setting('t.o')::uuid, null, 'Roti bakar', 6000, 18000, 20)::text, false);
select set_config('t.teh', public.create_product(current_setting('t.o')::uuid, null, 'Teh racik', 3000, 10000, 0, 'bar', false)::text, false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
select pg_temp.ok('B1 a new tracked product starts its stock book; an untracked one does not', pg_temp.p7() = '[]'::jsonb
  and (select count(*) from public.owner_list_stock(current_setting('t.o')::uuid) x(e), jsonb_array_elements(x.e)) = 2);

-- ===== the product form no longer changes a tracked product's stock
select public.update_product(current_setting('t.kopi')::uuid, current_setting('t.o')::uuid, null, 'Kopi susu gula aren', 8000, 23000, 999, 'kitchen', true);
select pg_temp.ok('F1 name and price saved, stock stays 50', pg_temp.stock('t.kopi') = 50
  and (select name = 'Kopi susu gula aren' and selling_price = 23000 from public.products where id = current_setting('t.kopi')::uuid));
-- Tracking starts with the stock the owner gives; it stops at 0.
select public.update_product(current_setting('t.teh')::uuid, current_setting('t.o')::uuid, null, 'Teh racik', 3000, 10000, 12, 'bar', true);
select pg_temp.ok('F2 tracking starts at 12, with a starting document', pg_temp.stock('t.teh') = 12 and pg_temp.p7() = '[]'::jsonb);

-- ===== documents
select pg_temp.fails('D1 stock in must be more than 0', $q$select pg_temp.doc('stock_in', jsonb_build_array(pg_temp.line('t.kopi', 0)))$q$, 'lebih dari 0');
select pg_temp.fails('D2 an adjustment needs a reason', $q$select pg_temp.doc('adjustment', jsonb_build_array(pg_temp.line('t.kopi', -2)))$q$, 'Alasan');
select pg_temp.fails('D3 stock cannot go below 0', $q$select pg_temp.doc('adjustment', jsonb_build_array(pg_temp.line('t.roti', -21)), 'Hilang')$q$, 'minus');
select pg_temp.fails('D4 one product once per document', $q$select pg_temp.doc('stock_in', jsonb_build_array(pg_temp.line('t.kopi', 1), pg_temp.line('t.kopi', 2)))$q$, 'sekali');
select pg_temp.fails('D5 bad numbers refused', $q$select pg_temp.doc('stock_in', '[{"productId": "x", "qty": "1"}]')$q$, 'tidak valid');
select pg_temp.doc('stock_in', jsonb_build_array(pg_temp.line('t.kopi', 30), pg_temp.line('t.roti', 10)), 'Kiriman pemasok');
select pg_temp.doc('adjustment', jsonb_build_array(pg_temp.line('t.roti', -3)), 'Roti basi');
select pg_temp.ok('D6 stock in and adjustment: kopi 80, roti 27, books agree', pg_temp.stock('t.kopi') = 80 and pg_temp.stock('t.roti') = 27 and pg_temp.p7() = '[]'::jsonb);

-- ===== sales, void, refund, correction keep the books right
select set_config('t.a', pg_temp.pay('t.kopi', 5, 'p-a')::text, false);
select set_config('t.bb', pg_temp.pay('t.roti', 2, 'p-b')::text, false);
select public.void_transaction_approved(current_setting('t.a')::uuid, 'Salah input', '271828');
select set_config('t.cc', pg_temp.pay('t.kopi', 3, 'p-c')::text, false);
select public.refund_items_approved(current_setting('t.cc')::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting('t.cc')::uuid), 'quantity', 1, 'restock', true)),
  'cash', 'Tumpah', '271828', 'r-1');
select public.owner_correct_bill(current_setting('t.bb')::uuid,
  jsonb_build_array(jsonb_build_object('itemId', (select id from public.transaction_items where transaction_id = current_setting('t.bb')::uuid), 'quantity', 1),
    jsonb_build_object('productId', current_setting('t.teh'), 'quantity', 2)), 'cash', '', '', 'Satu roti, dua teh');
select pg_temp.ok('M1 kopi 80 - 5 + 5 - 3 + 1 = 78, roti 27 - 2 + 2 - 1 = 26, teh 12 - 2 = 10; books agree',
  pg_temp.stock('t.kopi') = 78 and pg_temp.stock('t.roti') = 26 and pg_temp.stock('t.teh') = 10 and pg_temp.p7() = '[]'::jsonb);

-- ===== count (opname)
select set_config('t.op', pg_temp.doc('opname', jsonb_build_array(pg_temp.line('t.kopi', 75), pg_temp.line('t.roti', 26)), 'Hitung akhir minggu')::text, false);
select pg_temp.ok('O1 count: kopi 3 short booked, roti matches; the document shows book and count',
  pg_temp.stock('t.kopi') = 75 and pg_temp.p7() = '[]'::jsonb
  and (select (l ->> 'qty')::numeric = -3 and (l ->> 'counted')::numeric = 75 and (l ->> 'bookQty')::numeric = 78
       from jsonb_array_elements(current_setting('t.op')::jsonb -> 'lines') l where l ->> 'productId' = current_setting('t.kopi')));
reset role;
select pg_temp.ok('O2 the 3 lost kopi are a cost: 3 x 8.000 in stock adjustments',
  (select sum(amount) from public.ledger where doc_id = (current_setting('t.op')::jsonb ->> 'id')::uuid and account = 'stock_adjustment') = 24000);
select pg_temp.ok('O3 every stock document balances',
  not exists (select 1 from public.ledger where business_id = current_setting('t.b')::uuid and doc_type like 'stock_%' group by doc_id having sum(amount) <> 0));

-- ===== P7 catches a stock changed behind the system's back
update public.products set stock = stock + 4 where id = current_setting('t.kopi')::uuid;
select pg_temp.ok('X1 kopi off by 4: P7 reports it', exists (select 1 from jsonb_array_elements(pg_temp.p7()) f
  where f ->> 'ref' = current_setting('t.kopi') and (f -> 'detail' ->> 'stock')::numeric = 79 and (f -> 'detail' ->> 'book')::numeric = 75));
update public.products set stock = stock - 4 where id = current_setting('t.kopi')::uuid;
set role authenticated;

-- ===== lists
select pg_temp.ok('L1 the stock list: kopi 75 with its value and last count',
  (select (e ->> 'stock')::numeric = 75 and (e ->> 'value')::numeric = 75 * 8000 and e ->> 'lastCount' is not null
   from jsonb_array_elements(public.owner_list_stock(current_setting('t.o')::uuid)) e where e ->> 'productId' = current_setting('t.kopi')));
select pg_temp.ok('L2 the document history, newest first: the count on top',
  public.owner_list_stock_documents(current_setting('t.o')::uuid, now() - interval '1 day', now() + interval '1 day') -> 'rows' -> 0 ->> 'kind' = 'opname');

-- ===== other owners and expired plans
select set_config('request.jwt.claim.sub', 'e7400000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Nina', 'Satu', null);
select pg_temp.fails('X2 other owner cannot change the stock', $q$select pg_temp.doc('stock_in', jsonb_build_array(pg_temp.line('t.kopi', 1)))$q$, 'tidak ditemukan');
select set_config('request.jwt.claim.sub', 'e7400000-0000-0000-0000-000000000001', false);
reset role;
update public.subscriptions set expires_at = now() - interval '1 day' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select pg_temp.fails('X3 expired plan cannot change the stock', $q$select pg_temp.doc('stock_in', jsonb_build_array(pg_temp.line('t.kopi', 1)))$q$, 'Langganan berakhir');
reset role;
