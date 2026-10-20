-- Tests for 081 (customers by name in the backoffice). Every line of output must start with PASS.
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
-- One kopi (22.000) paid in cash for a customer name.
create or replace function pg_temp.pay(who text, k text) returns uuid language sql as $$
  select (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.c')::uuid, current_setting('t.o')::uuid,
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', current_setting('t.kopi'), 'quantity', 1)), 'customer_name', who),
    'cash', 1000000, null, k, null, null) ->> 'transactionId')::uuid
$$;
create or replace function pg_temp.list(q text default null) returns jsonb language sql as $$
  select public.owner_customers(null, now() - interval '1 day', now() + interval '1 day', q, 1)
$$;

select pg_temp.ok('S1 signed-in owners may call it, anon may not',
  has_function_privilege('authenticated', 'public.owner_customers(uuid, timestamptz, timestamptz, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.owner_customers(uuid, timestamptz, timestamptz, text, integer)', 'execute'));

insert into auth.users(id, email) values ('e8100000-0000-0000-0000-000000000001', 'pelanggan@kopi.id'), ('e8100000-0000-0000-0000-000000000002', 'lain@toko.id');
select set_config('request.jwt.claim.sub', 'e8100000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Pelanggan', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Rina', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Rina'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);
select public.owner_set_void_code('271828');
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);

-- Budi three times under different spellings, Ani once, one bill without a name.
select pg_temp.pay('Budi', 'c-1');
select pg_temp.pay('  budi ', 'c-2');
select set_config('t.b3', pg_temp.pay('BUDI', 'c-3')::text, false);
select pg_temp.pay('Ani', 'c-4');
select pg_temp.pay('', 'c-5');
-- Refund one of Budi's bills in full; void Ani's other bill.
select public.refund_items_approved(current_setting('t.b3')::uuid, current_setting('t.sh')::uuid, current_setting('t.c')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.transaction_items where transaction_id = current_setting('t.b3')::uuid), 'quantity', 1, 'restock', true)),
  'cash', 'Salah pesan', '271828', 'r-1');
select set_config('t.av', pg_temp.pay('Ani', 'c-6')::text, false);
select public.void_transaction_approved(current_setting('t.av')::uuid, 'salah input', '271828');

select set_config('t.l', pg_temp.list()::text, false);
select pg_temp.ok('C1 two customers; bills without a name are left out',
  (current_setting('t.l')::jsonb ->> 'total')::int = 2 and jsonb_array_length(current_setting('t.l')::jsonb -> 'rows') = 2);
select pg_temp.ok('C2 Budi first: 3 bills, 66.000 - 22.000 refund = 44.000, shown as typed last',
  current_setting('t.l')::jsonb -> 'rows' -> 0 ->> 'name' = 'BUDI'
  and (current_setting('t.l')::jsonb -> 'rows' -> 0 ->> 'bills')::int = 3
  and (current_setting('t.l')::jsonb -> 'rows' -> 0 ->> 'total')::numeric = 44000);
select pg_temp.ok('C3 Ani: the voided bill does not count',
  current_setting('t.l')::jsonb -> 'rows' -> 1 ->> 'name' = 'Ani'
  and (current_setting('t.l')::jsonb -> 'rows' -> 1 ->> 'bills')::int = 1
  and (current_setting('t.l')::jsonb -> 'rows' -> 1 ->> 'total')::numeric = 22000
  and current_setting('t.l')::jsonb -> 'rows' -> 1 ->> 'lastAt' is not null);
select pg_temp.ok('Q1 search ignores case and spaces', (pg_temp.list('  bu ') -> 'rows' -> 0 ->> 'name') = 'BUDI'
  and (pg_temp.list('  bu ') ->> 'total')::int = 1);
select pg_temp.ok('Q2 a search with no match is empty', (pg_temp.list('zzz') ->> 'total')::int = 0
  and pg_temp.list('zzz') -> 'rows' = '[]'::jsonb);
select pg_temp.ok('P1 an empty period is empty',
  (public.owner_customers(null, now() - interval '10 days', now() - interval '9 days', null, 1) ->> 'total')::int = 0);
select pg_temp.fails('R1 reversed range', 'select public.owner_customers(null, now(), now() - interval ''1 day'', null, 1)', 'tidak valid');

-- Another business sees nothing and cannot ask for this outlet.
select set_config('request.jwt.claim.sub', 'e8100000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Lain', 'Satu', null);
select pg_temp.ok('X1 another owner sees no customers', (pg_temp.list() ->> 'total')::int = 0);
select pg_temp.fails('X2 another owner cannot read this outlet',
  format('select public.owner_customers(%L, now() - interval ''1 day'', now() + interval ''1 day'', null, 1)', current_setting('t.o')), 'tidak ditemukan');
reset role;
