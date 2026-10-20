-- Tests for 080 (product photos set by the owner). Every line of output must start with PASS.
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
create or replace function pg_temp.img() returns text language sql as $$
  select image_url from public.products where id = current_setting('t.p')::uuid
$$;

select pg_temp.ok('S1 signed-in owners may call it, anon may not',
  has_function_privilege('authenticated', 'public.owner_set_product_image(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.owner_set_product_image(uuid, text)', 'execute'));

insert into auth.users(id, email) values ('e8000000-0000-0000-0000-000000000001', 'foto@kopi.id'), ('e8000000-0000-0000-0000-000000000002', 'lain@toko.id');
select set_config('request.jwt.claim.sub', 'e8000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Foto', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select set_config('t.p', public.create_product(current_setting('t.o')::uuid, null, 'Kopi susu', 8000, 22000, 100)::text, false);

select public.owner_set_product_image(current_setting('t.p')::uuid, ' https://x.supabase.co/storage/v1/object/public/product-images/a/b/c-1.webp ');
reset role;
select pg_temp.ok('I1 the photo is set, trimmed', pg_temp.img() = 'https://x.supabase.co/storage/v1/object/public/product-images/a/b/c-1.webp');
set role authenticated;
select pg_temp.fails('I2 only https', format('select public.owner_set_product_image(%L, %L)', current_setting('t.p'), 'http://x/a.webp'), 'https');
select public.owner_set_product_image(current_setting('t.p')::uuid, '');
reset role;
select pg_temp.ok('I3 an empty url removes the photo', pg_temp.img() is null);

-- Another business cannot touch it.
set role authenticated;
select public.owner_set_product_image(current_setting('t.p')::uuid, 'https://x/keep.webp');
select set_config('request.jwt.claim.sub', 'e8000000-0000-0000-0000-000000000002', false);
select public.register_business('Toko Lain', 'Satu', null);
select pg_temp.fails('X1 another owner cannot change it', format('select public.owner_set_product_image(%L, %L)', current_setting('t.p'), ''), 'tidak ditemukan');
reset role;
select pg_temp.ok('X2 the photo is unchanged', pg_temp.img() = 'https://x/keep.webp');

-- Expired subscription: refused.
update public.subscriptions set expires_at = now() - interval '1 day' where business_id = current_setting('t.b')::uuid;
select set_config('request.jwt.claim.sub', 'e8000000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.fails('L1 expired: refused', format('select public.owner_set_product_image(%L, %L)', current_setting('t.p'), ''), 'Langganan berakhir');
reset role;
