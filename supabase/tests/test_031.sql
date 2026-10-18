-- Tests for 031_web_backoffice.sql on top of migrations 001 to 031.
-- Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when cond then 'PASS ' else 'FAIL ' end) || label; end $$;
-- Runs a statement and reports whether it raised an error containing the expected text.
create or replace function pg_temp.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL % (no error)', label;
exception when others then
  raise notice '%', (case when sqlerrm ilike '%' || expect || '%' then 'PASS ' else 'FAIL ' end) || label || ' -> ' || sqlerrm;
end $$;

-- fixtures: u1 owns b1 (monthly, 7 days left), u2 owns b2 (expired 8 days ago), u3 has no business.
-- Rows are inserted directly so the ids are fixed; the 030 triggers still run (trial on insert, limits).
insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000001','rina@kafe.id'),('00000000-0000-0000-0000-000000000002','dedi@kafe.id'),('00000000-0000-0000-0000-000000000003','new@kafe.id');
insert into public.businesses(id,name) values ('10000000-0000-0000-0000-000000000001','Kopi Pojok'),('10000000-0000-0000-0000-000000000002','Warung Dedi');
insert into public.business_members(business_id,auth_user_id) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
insert into public.outlets(id,business_id,name) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Utama'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Dedi 1');
insert into public.products(id,outlet_id,name,selling_price) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Kopi susu',22000),('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Latte',26000),('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','Teh',15000);
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '7 days' where business_id = '10000000-0000-0000-0000-000000000001';
update public.subscriptions set plan_code = 'monthly', expires_at = now() - interval '8 days', extra_outlets = 1 where business_id = '10000000-0000-0000-0000-000000000002';

-- Dates in RPCs follow Asia/Jakarta, so tests do too.
select set_config('t.today', (now() at time zone 'Asia/Jakarta')::date::text, false);
set role authenticated;
-- ===== profiles
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select pg_temp.ok('P1 username available before use', public.username_available('kopipojok'));
select pg_temp.ok('P2 invalid username not available', not public.username_available('Ab'));
select pg_temp.ok('P3 save profile lowercases username', (public.save_my_profile('Rina Sari','KopiPojok','0812 3456')->>'username') = 'kopipojok');
select pg_temp.ok('P4 profile includes email', (public.get_my_profile()->>'email') = 'rina@kafe.id');
select pg_temp.ok('P5 username taken after save', not public.username_available('kopipojok'));
select pg_temp.fails('P6 bad username refused', $q$select public.save_my_profile('x','a b','')$q$, 'Username 3 sampai 20');
select pg_temp.fails('P7 bad whatsapp refused', $q$select public.save_my_profile('x','rina2','abc')$q$, 'WhatsApp');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select pg_temp.fails('P8 duplicate username refused', $q$select public.save_my_profile('Dedi','kopipojok','')$q$, 'sudah dipakai');
select pg_temp.ok('P9 expired owner can still save profile', (public.save_my_profile('Dedi','dedi_w','')->>'username') = 'dedi_w');
select pg_temp.ok('P10 RLS: other profiles invisible', (select count(*) from public.profiles) = 1);
select pg_temp.fails('P11 resolve_login_email not callable by users', $q$select public.resolve_login_email('kopipojok')$q$, 'permission denied');
reset role;
select pg_temp.ok('P12 resolve username to email (service)', public.resolve_login_email(' KopiPojok ') = 'rina@kafe.id');
select pg_temp.ok('P13 resolve email passes through', public.resolve_login_email('Rina@Kafe.id') = 'rina@kafe.id');
select pg_temp.ok('P14 unknown username resolves to null', public.resolve_login_email('nobody') is null);
set role anon;
select pg_temp.ok('P15 anon can check username', public.username_available('fresh_name'));
reset role;

-- ===== business settings
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select pg_temp.ok('B1 defaults returned', (public.owner_get_business()->>'timezone') = 'Asia/Jakarta' and (public.owner_get_business()->'receipt'->>'show_logo')::boolean);
select pg_temp.ok('B2 update business', (public.owner_update_business('Kopi Pojok 2','restoran','Bandung','Asia/Makassar')->>'business_type') = 'restoran');
select pg_temp.fails('B3 bad type refused', $q$select public.owner_update_business('A','bar','','Asia/Jakarta')$q$, 'jenis usaha');
select pg_temp.fails('B4 bad tz refused', $q$select public.owner_update_business('A','kafe','','Europe/Paris')$q$, 'zona waktu');
select pg_temp.fails('B5 empty name refused', $q$select public.owner_update_business('  ','kafe','','Asia/Jakarta')$q$, 'Nama bisnis');
select pg_temp.ok('B6 receipt keeps only known keys', (select (r ? 'evil') = false and r->>'footer' = 'Sampai jumpa' and (r->>'show_cashier')::boolean = false
  from (select public.owner_update_receipt('{"footer":"Sampai jumpa","show_cashier":false,"evil":"x"}') r) s));
select pg_temp.ok('B7 receipt untouched keys kept', (public.owner_get_business()->'receipt'->>'show_logo')::boolean);
select pg_temp.fails('B8 receipt text over 120 refused', format('select public.owner_update_receipt(%L)', jsonb_build_object('header', repeat('x',121))), '120');
select pg_temp.fails('B9 receipt non-boolean switch refused', $q$select public.owner_update_receipt('{"show_tax":"yes"}')$q$, 'tidak valid');
select pg_temp.ok('B10 notify switch saved', (public.owner_update_notify('{"low_stock":false}')->>'low_stock')::boolean = false);
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select pg_temp.fails('B11 expired: business update refused', $q$select public.owner_update_business('A','kafe','','Asia/Jakarta')$q$, 'Langganan berakhir');
select pg_temp.fails('B12 expired: receipt update refused', $q$select public.owner_update_receipt('{"footer":"x"}')$q$, 'Langganan berakhir');
select pg_temp.ok('B13 expired: notify still allowed', (public.owner_update_notify('{"subscription":true}')->>'subscription')::boolean);
select pg_temp.ok('B14 expired: read still allowed', (public.owner_get_business()->>'name') = 'Warung Dedi');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select pg_temp.fails('B15 no business refused', $q$select public.owner_get_business()$q$, 'Hanya owner');

-- ===== vouchers
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select pg_temp.ok('V1 create bill voucher', public.owner_save_voucher(null,'hemat10','bill','percent',10,50000,100,current_date+30,null) is not null);
select pg_temp.ok('V2 code uppercased and listed', (public.owner_list_vouchers()->0->>'code') = 'HEMAT10');
select pg_temp.ok('V3 status active', (public.owner_list_vouchers()->0->>'status') = 'active');
select pg_temp.fails('V4 duplicate code refused', $q$select public.owner_save_voucher(null,'HEMAT10','bill','amount',5000,0,null,current_date+1,null)$q$, 'sudah dipakai');
select pg_temp.fails('V5 short code refused', $q$select public.owner_save_voucher(null,'AB','bill','amount',5000,0,null,current_date+1,null)$q$, '4 sampai 12');
select pg_temp.fails('V6 percent over 100 refused', $q$select public.owner_save_voucher(null,'P101','bill','percent',101,0,null,current_date+1,null)$q$, '1 sampai 100');
select pg_temp.fails('V7 amount under 1000 refused', $q$select public.owner_save_voucher(null,'A999','bill','amount',999,0,null,current_date+1,null)$q$, 'Rp1.000');
select pg_temp.fails('V8 past expiry refused', $q$select public.owner_save_voucher(null,'OLD1','bill','amount',5000,0,null,current_date-5,null)$q$, 'sebelum hari ini');
select pg_temp.fails('V9 products scope needs products', $q$select public.owner_save_voucher(null,'PROD1','products','amount',5000,0,null,current_date+1,'{}')$q$, 'minimal satu produk');
select pg_temp.fails('V10 other business product refused', $q$select public.owner_save_voucher(null,'PROD2','products','amount',5000,0,null,current_date+1,array['30000000-0000-0000-0000-000000000003']::uuid[])$q$, 'tidak ditemukan');
select set_config('t.v2', public.owner_save_voucher(null,'KOPI','products','amount',5000,0,2,current_date+10,array['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[])::text, false);
select pg_temp.ok('V11 product voucher keeps distinct products', (select jsonb_array_length(v->'product_ids') from jsonb_array_elements(public.owner_list_vouchers()) v where v->>'code' = 'KOPI') = 2);
select pg_temp.ok('V12 edit keeps the same id', public.owner_save_voucher(current_setting('t.v2')::uuid,'KOPI','bill','amount',5000,0,2,current_date+10,null) = current_setting('t.v2')::uuid);
select pg_temp.ok('V12b edit to bill scope clears products', (select count(*) from public.voucher_products) = 0);
select public.owner_set_voucher_active(current_setting('t.v2')::uuid, false);
select pg_temp.ok('V13 switched off shows inactive', (select v->>'status' from jsonb_array_elements(public.owner_list_vouchers()) v where v->>'code' = 'KOPI') = 'inactive');
reset role;
update public.vouchers set is_active = true, used_count = 2 where code = 'KOPI';
set role authenticated;
select pg_temp.ok('V14 quota reached shows used_up', (select v->>'status' from jsonb_array_elements(public.owner_list_vouchers()) v where v->>'code' = 'KOPI') = 'used_up');
reset role;
update public.vouchers set expires_on = current_date - 40 where code = 'HEMAT10';
set role authenticated;
select pg_temp.ok('V15 past date shows expired', (select v->>'status' from jsonb_array_elements(public.owner_list_vouchers()) v where v->>'code' = 'HEMAT10') = 'expired');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select pg_temp.ok('V16 RLS: other business vouchers invisible', (select count(*) from public.vouchers) = 0 and jsonb_array_length(public.owner_list_vouchers()) = 0);
select pg_temp.fails('V17 expired: create voucher refused', $q$select public.owner_save_voucher(null,'DEDI','bill','amount',5000,0,null,current_date+1,null)$q$, 'Langganan berakhir');
select pg_temp.fails('V18 cannot toggle other business voucher', format('select public.owner_set_voucher_active(%L,true)', current_setting('t.v2')), 'Langganan berakhir');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select pg_temp.fails('V19 unknown voucher toggle refused', $q$select public.owner_set_voucher_active(gen_random_uuid(),true)$q$, 'tidak ditemukan');

-- ===== product switch
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select public.owner_set_product_active('30000000-0000-0000-0000-000000000002', false);
select pg_temp.ok('S1 product switched off', (select not is_active from public.products where id = '30000000-0000-0000-0000-000000000002'));
select public.owner_set_product_active('30000000-0000-0000-0000-000000000002', true);
select pg_temp.ok('S2 product switched on', (select is_active from public.products where id = '30000000-0000-0000-0000-000000000002'));
select pg_temp.fails('S3 other business product refused', $q$select public.owner_set_product_active('30000000-0000-0000-0000-000000000003', false)$q$, 'tidak ditemukan');
reset role;
insert into public.products(outlet_id, name, selling_price) select '20000000-0000-0000-0000-000000000001', 'P' || g, 1000 from generate_series(1, 98) g;
update public.products set is_active = false where id = '30000000-0000-0000-0000-000000000002';
insert into public.products(outlet_id, name, selling_price) values ('20000000-0000-0000-0000-000000000001', 'Extra', 1000);
set role authenticated;
select pg_temp.fails('S4 reactivation over the 100 limit refused', $q$select public.owner_set_product_active('30000000-0000-0000-0000-000000000002', true)$q$, 'Batas 100');
reset role;
delete from public.products where name ~ '^(P[0-9]+|Extra)$';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select pg_temp.fails('S5 expired: switch refused', $q$select public.owner_set_product_active('30000000-0000-0000-0000-000000000003', true)$q$, 'Langganan berakhir');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ===== checkout
select pg_temp.ok('C1 quote monthly', public.plan_quote('monthly',0) = 149000);
select pg_temp.ok('C2 quote 6 months with 2 extra outlets', public.plan_quote('semiannual',2) = 699000 + 2*99000*6);
select pg_temp.ok('C3 quote annual', public.plan_quote('annual',0) = 1399000);
select pg_temp.fails('C4 unknown plan refused', $q$select public.plan_quote('trial',0)$q$, 'Pilih paket');
-- +2, not +1: this business moved to Asia/Makassar in B2, which is a day ahead of Jakarta between 23.00 and 24.00 WIB.
select pg_temp.fails('C5 future transfer date refused', $q$select public.owner_submit_payment('monthly',0,'Rina Sari','BCA',current_setting('t.today')::date+2,149000,'')$q$, 'setelah hari ini');
select pg_temp.fails('C6 old transfer date refused', $q$select public.owner_submit_payment('monthly',0,'Rina Sari','BCA',current_setting('t.today')::date-31,149000,'')$q$, '30 hari');
select pg_temp.fails('C7 missing sender refused', $q$select public.owner_submit_payment('monthly',0,' ','BCA',current_setting('t.today')::date,149000,'')$q$, 'nama pengirim');
select pg_temp.ok('C8 submit payment gives invoice number', (public.owner_submit_payment('monthly',1,'Rina Sari','BCA',current_setting('t.today')::date,248000,'transfer pagi')->>'invoice_number') ~ '^INV-\d{8}-\d{5}$');
select pg_temp.ok('C9 amount due computed by server', (public.owner_list_payments()->0->>'amount_due')::bigint = 248000);
select pg_temp.fails('C10 second pending refused', $q$select public.owner_submit_payment('monthly',0,'Rina Sari','BCA',current_setting('t.today')::date,149000,'')$q$, 'sedang diperiksa');
select pg_temp.fails('C11 owner cannot verify', format('select public.admin_verify_payment(%L)', (public.owner_list_payments()->0->>'id')), 'permission denied');
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select pg_temp.ok('C12 expired owner can submit payment', (public.owner_submit_payment('annual',1,'Dedi','BRI',current_setting('t.today')::date-2,2587000,'')->>'status') = 'submitted');
select pg_temp.ok('C13 RLS: sees only own payments', (select count(*) from public.payment_confirmations) = 1);
reset role;
select set_config('t.pay', (select id::text from public.payment_confirmations where plan_code = 'annual'), false);
select pg_temp.ok('C14 admin verify marks verified', (public.admin_verify_payment(current_setting('t.pay')::uuid)->>'status') = 'verified');
select pg_temp.ok('C14b expired plan renewed from today', (select expires_at > now() + interval '11 months' and expires_at < now() + interval '13 months' from public.subscriptions where business_id = '10000000-0000-0000-0000-000000000002'));
select pg_temp.ok('C14c new expiry stored on the payment', (select new_expires_at is not null from public.payment_confirmations where id = current_setting('t.pay')::uuid));
select pg_temp.fails('C15 verify twice refused', format('select public.admin_verify_payment(%L)', current_setting('t.pay')), 'sudah diproses');
select pg_temp.ok('C16 verify the active business payment', (select public.admin_verify_payment(id)->>'status' from public.payment_confirmations where plan_code = 'monthly') = 'verified');
select pg_temp.ok('C16b renewal while active adds to the remaining 7 days', (select expires_at > now() + interval '1 month' + interval '6 days' from public.subscriptions where business_id = '10000000-0000-0000-0000-000000000001'));
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select pg_temp.ok('C17 after renewal writes work again', public.owner_save_voucher(null,'DEDI','bill','amount',5000,0,null,current_date+1,null) is not null);
select set_config('t.p2', (public.owner_submit_payment('monthly',0,'Dedi','BRI',current_setting('t.today')::date,149000,'')->>'id'), false);
reset role;
select pg_temp.ok('C18 admin reject stores reason', (public.admin_reject_payment(current_setting('t.p2')::uuid, 'Dana belum masuk')->>'reject_reason') = 'Dana belum masuk');
select pg_temp.fails('C19 reject twice refused', format('select public.admin_reject_payment(%L,%L)', current_setting('t.p2'), 'x'), 'sudah diproses');
