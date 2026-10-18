-- Tests for 061 (quantity sold per product) on top of 001 to 061.
-- Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;

select pg_temp.ok('S1 anon cannot call it', not has_function_privilege('anon', 'public.owner_product_sales(uuid, timestamptz, timestamptz)', 'execute'));
select pg_temp.ok('S2 signed-in owners can', has_function_privilege('authenticated', 'public.owner_product_sales(uuid, timestamptz, timestamptz)', 'execute'));
select pg_temp.ok('S3 it runs as definer with a fixed search_path',
  (select prosecdef and proconfig @> array['search_path=public'] from pg_proc where proname = 'owner_product_sales'));
