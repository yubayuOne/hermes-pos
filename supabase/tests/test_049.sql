-- Tests for 049 (anon cannot execute security definer functions) on top of 001 to 049.
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

set role anon;
select pg_temp.fails('A1 anon cannot open a shift', 'select public.open_shift(gen_random_uuid(), gen_random_uuid(), 0)', 'permission denied');
select pg_temp.fails('A2 anon cannot reach owner functions', 'select public.owner_get_business()', 'permission denied');
select pg_temp.fails('A3 anon cannot list device cashiers', 'select * from public.list_device_cashiers()', 'permission denied');
select pg_temp.ok('A4 anon can still check a username (sign-up form)', public.username_available('free_name_049'));
select pg_temp.ok('A5 anon can still read plan prices', public.plan_quote('monthly', 0) > 0);
reset role;

insert into auth.users(id, email) values ('b4900000-0000-0000-0000-000000000001', 'sembilan@kedai.id');
select set_config('request.jwt.claim.sub', 'b4900000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.ok('B1 a signed-in user still reaches functions (fails inside, not on permission)',
  (select count(*) from public.list_device_cashiers()) = 0);
select pg_temp.fails('B2 internal functions stay closed to users', 'select public.complete_checkout_core(null,null,null,null,null,null,null,null,null,null)', 'permission denied');
