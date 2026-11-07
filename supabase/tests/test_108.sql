-- Tests for 108 (the sidebar menus an owner hides). Every line of output must start with PASS.
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

insert into auth.users(id, email) values ('10800000-0000-0000-0000-000000000001', 'pemilik@sidebar.id');
select set_config('request.jwt.claim.sub', '10800000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Warung Sidebar', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;

select pg_temp.ok('N1 by default nothing is hidden',
  jsonb_typeof(public.owner_get_business() -> 'sidebar_hidden') = 'array'
  and jsonb_array_length(public.owner_get_business() -> 'sidebar_hidden') = 0);
select set_config('t.hid', cardinality(public.owner_update_sidebar(array['/vouchers', '/outlets', '/vouchers']))::text, false);
select pg_temp.ok('N2 hiding two menus is saved, duplicates counted once',
  current_setting('t.hid')::int = 2 and jsonb_array_length(public.owner_get_business() -> 'sidebar_hidden') = 2);
select pg_temp.ok('N3 the business shows the hidden menus to the app',
  (public.owner_get_business() -> 'sidebar_hidden') @> '["/vouchers"]'::jsonb);
select pg_temp.ok('N4 showing everything again clears the list',
  cardinality(public.owner_update_sidebar('{}'::text[])) = 0);
select pg_temp.fails('N5 an unknown menu is refused',
  $q$select public.owner_update_sidebar(array['/pengaturan'])$q$, 'Menu tidak dikenal');
select pg_temp.fails('N6 hiding every menu is refused',
  $q$select public.owner_update_sidebar(array['/', '/transactions', '/closing', '/expenses', '/stock', '/customers', '/products', '/ingredients', '/resep', '/tables', '/vouchers', '/outlets', '/cashiers'])$q$,
  'Sisakan minimal satu menu');
