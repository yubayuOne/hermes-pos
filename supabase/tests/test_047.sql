-- Tests for 047 (outlet address and receipt text per outlet) on top of 001 to 047.
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

insert into auth.users(id, email) values ('b4700000-0000-0000-0000-000000000001', 'tiga@kedai.id'), ('b4700000-0000-0000-0000-000000000002', 'lain@kedai.id');
select set_config('request.jwt.claim.sub', 'b4700000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kedai Tiga', 'Pusat', null)::text, false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Tia', '123456');

select public.owner_update_outlet(current_setting('t.o')::uuid, 'Pusat', 'Jl. Braga 12', '022 111', true, 'Cabang Braga', 'Follow @kedai');
select pg_temp.ok('O1 address, header, footer reach the POS list',
  (select outlet_address = 'Jl. Braga 12' and outlet_receipt_header = 'Cabang Braga' and outlet_receipt_footer = 'Follow @kedai' from public.list_device_cashiers()));

-- Five-argument call (as onboarding does): header and footer stay, address follows the call.
select public.owner_update_outlet(current_setting('t.o')::uuid, 'Pusat', 'Jl. Asia Afrika 1', '022 111', true);
select pg_temp.ok('O2 old call keeps header and footer, changes address',
  (select outlet_address = 'Jl. Asia Afrika 1' and outlet_receipt_header = 'Cabang Braga' and outlet_receipt_footer = 'Follow @kedai' from public.list_device_cashiers()));

select public.owner_update_outlet(current_setting('t.o')::uuid, 'Pusat', 'Jl. Asia Afrika 1', '022 111', true, '', null);
select pg_temp.ok('O3 empty text clears the header, null keeps the footer',
  (select outlet_receipt_header is null and outlet_receipt_footer = 'Follow @kedai' from public.list_device_cashiers()));

select public.owner_update_outlet(current_setting('t.o')::uuid, 'Pusat Baru', null, null, true);
select pg_temp.ok('O4 empty address and phone clear them, name follows to the cashier list',
  (select outlet_address is null and outlet_name = 'Pusat Baru' from public.list_device_cashiers()));

select pg_temp.fails('O5 text over 120 characters is refused',
  format('select public.owner_update_outlet(%L, ''Pusat'', null, null, true, %L, null)', current_setting('t.o'), repeat('x', 121)), '120');
select pg_temp.fails('O6 name is required',
  format('select public.owner_update_outlet(%L, '' '', null, null, true)', current_setting('t.o')), 'Nama outlet wajib');

select set_config('request.jwt.claim.sub', 'b4700000-0000-0000-0000-000000000002', false);
select pg_temp.fails('O7 another account cannot edit this outlet',
  format('select public.owner_update_outlet(%L, ''Curi'', null, null, true)', current_setting('t.o')), 'owner');
