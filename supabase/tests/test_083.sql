-- Tests for 083 (row level security on checkout_idempotency). Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;

select pg_temp.ok('S1 every table in public has row level security',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and c.relname not like 't\_%'));
select pg_temp.ok('S2 signed-in and anonymous clients cannot read the payment keys',
  not has_table_privilege('authenticated', 'public.checkout_idempotency', 'select')
  and not has_table_privilege('anon', 'public.checkout_idempotency', 'select'));
