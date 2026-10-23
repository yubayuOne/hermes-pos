-- Tests for 085 (the recipe saved on its own page). Every line of output must start with PASS.
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
create or replace function pg_temp.prod(col text) returns text language plpgsql security definer as $$
declare v text;
begin execute format('select %I::text from public.products where id = %L', col, current_setting('t.p')) into v; return v; end $$;

insert into auth.users(id, email) values ('e8500000-0000-0000-0000-000000000001', 'resep2@kopi.id'), ('e8500000-0000-0000-0000-000000000002', 'lain2@resep.id');
select set_config('request.jwt.claim.sub', 'e8500000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Resep Dua', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select set_config('t.p', public.create_product(current_setting('t.o')::uuid, null, 'Es teh', 4000, 10000, 100)::text, false);
select set_config('t.teh', public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'Teh', 30000, 1, 'kg')::text, false);
select set_config('t.gula', public.owner_save_ingredient(current_setting('t.o')::uuid, null, 'Gula', 15000, 1, 'kg')::text, false);

select pg_temp.ok('S1 owners may call it, anon may not',
  has_function_privilege('authenticated', 'public.owner_save_recipe(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.owner_save_recipe(uuid, jsonb)', 'execute'));

-- 5 g tea = 150, 20 g sugar = 300.
select public.owner_save_recipe(current_setting('t.p')::uuid, jsonb_build_array(
  jsonb_build_object('ingredientId', current_setting('t.teh'), 'qty', 5, 'unit', 'g'),
  jsonb_build_object('ingredientId', current_setting('t.gula'), 'qty', 20, 'unit', 'g')));
select pg_temp.ok('S2 a recipe is saved and prices the product', pg_temp.prod('hpp') = '450.00' and pg_temp.prod('hpp_source') = 'recipe');

select pg_temp.fails('S3 an invalid recipe is refused and the saved one stays', format('select public.owner_save_recipe(%L, %L::jsonb)', current_setting('t.p'),
  jsonb_build_array(jsonb_build_object('ingredientId', current_setting('t.teh'), 'qty', 5, 'unit', 'ml'))::text), 'Satuan tidak cocok');
select pg_temp.ok('S3b the saved recipe and HPP are unchanged', pg_temp.prod('hpp') = '450.00'
  and (select count(*) from public.owner_get_recipe(current_setting('t.p')::uuid) r, jsonb_array_elements(r -> 'lines')) = 2);

select public.owner_save_recipe(current_setting('t.p')::uuid, '[]'::jsonb);
select pg_temp.ok('S4 removing the recipe keeps the last HPP and turns the product manual', pg_temp.prod('hpp') = '450.00' and pg_temp.prod('hpp_source') = 'manual');

select set_config('request.jwt.claim.sub', 'e8500000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Lain Dua', 'Satu', null);
select pg_temp.fails('S5 another business cannot save it', format('select public.owner_save_recipe(%L, %L::jsonb)', current_setting('t.p'), '[]'), 'Sesi kasir tidak valid');
select pg_temp.fails('S6 an unknown product', format('select public.owner_save_recipe(%L, %L::jsonb)', gen_random_uuid(), '[]'), 'Produk tidak ditemukan');
reset role;
