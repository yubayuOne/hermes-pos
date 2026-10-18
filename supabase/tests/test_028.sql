-- Uji migrasi 028: hak baca owner, katalog di outlet tanpa kasir, laporan lintas outlet, isolasi antar bisnis.
-- Butuh migrasi 001-028 pada Postgres uji dengan stub auth. MENGOSONGKAN data uji.
-- Setiap baris keluaran berakhir PASS atau FAIL.
\set ON_ERROR_STOP on
-- 032 hides void_transaction behind the owner approval code. This helper keeps the void rules under test.
reset role;
create or replace function public.t_void(p uuid, r text) returns jsonb language sql security definer set search_path = public as $$ select public.void_transaction(p, r) $$;
grant execute on function public.t_void(uuid, text) to authenticated;
\pset tuples_only on
reset role;
create extension if not exists pgcrypto;
revoke select on public.cashier_sessions from anon, authenticated;
grant select (id, auth_user_id, cashier_id, outlet_id, cashier_name, outlet_name, terminal_name, is_active, created_at) on public.cashier_sessions to authenticated;
grant all on public.businesses, public.business_members to authenticated;
truncate transactions, transaction_items, payments, shifts, held_bills, cash_ledger, products, categories, cashier_sessions, outlets, business_members, businesses cascade;
delete from auth.users;
drop table if exists public.t_chk;
create table public.t_chk(name text, ok boolean, detail text);
grant all on public.t_chk to authenticated;
create or replace function public.t_ck(n text, c boolean, d text default '') returns void language sql as $$ insert into public.t_chk values(n, coalesce(c,false), d) $$;
grant execute on function public.t_ck(text,boolean,text) to authenticated;
create or replace function public.t_err(n text, q text, expect text) returns void language plpgsql as $$
begin
  execute q;
  perform t_ck(n, false, 'tidak error');
exception when others then
  perform t_ck(n, sqlerrm like expect, sqlerrm);
end $$;
grant execute on function public.t_err(text,text,text) to authenticated;
select gen_random_uuid() as u1 \gset
select gen_random_uuid() as u2 \gset
select gen_random_uuid() as u3 \gset
insert into auth.users values(:'u1'),(:'u2'),(:'u3');
select set_config('t.u1',:'u1',false), set_config('t.u2',:'u2',false), set_config('t.u3',:'u3',false);

-- Data: owner u1 (outlet o1, o1b, o1c tanpa kasir), owner u2 (o2), u3 bukan owner
set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
select (register_business('Bisnis Satu','Outlet 1')->>'outlet_id') as o1 \gset
-- 030 limits a trial to one outlet; this test needs three, so the business gets a paid plan with extra outlets.
reset role;
update public.subscriptions set plan_code = 'monthly', extra_outlets = 2, expires_at = now() + interval '30 days';
set role authenticated;
select owner_create_outlet('Outlet 1B') as o1b \gset
select owner_create_outlet('Outlet 1C') as o1c \gset
select owner_create_cashier(:'o1','Budi','111111') as c1 \gset
select owner_create_cashier(:'o1b','Sari','222222') as c2 \gset
select set_config('request.jwt.claim.sub',:'u2',false);
select (register_business('Bisnis Dua','Outlet 2')->>'outlet_id') as o2 \gset
select owner_create_cashier(:'o2','Dewi','333333') as c3 \gset
reset role;
insert into products(outlet_id,name,hpp,selling_price,stock,station) values
 (:'o1','A',4000,10000,1000,'kitchen'),(:'o1','B',6000,15000,1000,'kitchen'),
 (:'o1b','C',1000,3333,1000,'bar'),
 (:'o1c','Hanya Owner',1,2,3,'bar'),
 (:'o2','A',4000,10000,1000,'kitchen');
select set_config('t.o1',:'o1',false), set_config('t.o1b',:'o1b',false), set_config('t.o1c',:'o1c',false), set_config('t.o2',:'o2',false),
       set_config('t.c1',:'c1',false), set_config('t.c2',:'c2',false), set_config('t.c3',:'c3',false);

-- Transaksi
set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
select open_shift(:'c1',:'o1',50000) as sh1 \gset
select open_shift(:'c2',:'o1b',20000) as sh2 \gset
do $$
declare pa uuid; pb uuid; pc uuid; r jsonb; v jsonb; sh1 uuid; sh2 uuid;
begin
  select id into pa from products where name='A' and outlet_id=current_setting('t.o1')::uuid;
  select id into pb from products where name='B';
  select id into pc from products where name='C';
  select id into sh1 from shifts where cashier_id=current_setting('t.c1')::uuid;
  select id into sh2 from shifts where cashier_id=current_setting('t.c2')::uuid;
  r := complete_checkout(sh1,current_setting('t.c1')::uuid,current_setting('t.o1')::uuid,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',2))),'cash',50000,null,'k1',null,null);
  perform set_config('t.bill1', r->>'transactionId', false);
  r := complete_checkout(sh1,current_setting('t.c1')::uuid,current_setting('t.o1')::uuid,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pb,'quantity',1))),'qris',15000,null,'k2',null,null);
  r := complete_checkout(sh2,current_setting('t.c2')::uuid,current_setting('t.o1b')::uuid,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pc,'quantity',1))),'cash',5000,null,'k3',null,null);
  perform save_held_bill(sh1,current_setting('t.c1')::uuid,current_setting('t.o1')::uuid,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1))),'h1');
  r := complete_checkout(sh1,current_setting('t.c1')::uuid,current_setting('t.o1')::uuid,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1))),'cash',10000,null,'k4',null,null);
  perform t_void((r->>'transactionId')::uuid,'salah input');
end $$;
select set_config('request.jwt.claim.sub',:'u2',false);
select open_shift(:'c3',:'o2',10000) as sh3 \gset
do $$
declare pa uuid; r jsonb; sh3 uuid;
begin
  select id into pa from products where outlet_id=current_setting('t.o2')::uuid and name='A';
  select id into sh3 from shifts where cashier_id=current_setting('t.c3')::uuid;
  r := complete_checkout(sh3,current_setting('t.c3')::uuid,current_setting('t.o2')::uuid,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1))),'cash',10000,null,'k5',null,null);
  perform set_config('t.bill4', r->>'transactionId', false);
end $$;

-- A. ringkasan penjualan
select set_config('request.jwt.claim.sub',:'u1',false);
do $$
declare s jsonb; f timestamptz := now() - interval '1 day'; t timestamptz := now() + interval '1 day'; pf timestamptz := now() - interval '3 days'; pt timestamptz := now() - interval '1 day';
begin
  s := owner_sales_summary(null,f,t,pf,pt);
  perform t_ck('A1 jumlah bill selesai semua outlet = 3', (s->>'count')::int=3, s->>'count');
  perform t_ck('A2 penjualan = 38333', (s->>'sales')::numeric=38333, s->>'sales');
  perform t_ck('A3 tunai 23333 dan QRIS 15000', (s->>'cash')::numeric=23333 and (s->>'qris')::numeric=15000);
  perform t_ck('A4 laba = penjualan - HPP = 23333', (s->>'profit')::numeric=23333, s->>'profit');
  perform t_ck('A5 bill batal dilaporkan terpisah (1 / 10000)', (s->>'voidedCount')::int=1 and (s->>'voidedTotal')::numeric=10000, s->>'voidedCount');
  perform t_ck('A6 bill ditahan tidak dihitung', (s->>'totalItems')::numeric=4, s->>'totalItems');
  perform t_ck('A7 periode pembanding kosong = 0', (s->>'previousSales')::numeric=0);
  perform t_ck('A8 rincian per outlet (2 outlet berpenjualan + 1 kosong)', jsonb_array_length(s->'byOutlet')=3, (s->'byOutlet')::text);
  perform t_ck('A9 outlet 1 = 2 bill / 35000', (select (x->>'sales')::numeric from jsonb_array_elements(s->'byOutlet') x where x->>'name'='Outlet 1')=35000);
  perform t_ck('A10 outlet tanpa penjualan tampil 0', (select (x->>'count')::int from jsonb_array_elements(s->'byOutlet') x where x->>'name'='Outlet 1C')=0);
  perform t_ck('A11 rincian per kasir (Budi 35000, Sari 3333)', (select (x->>'sales')::numeric from jsonb_array_elements(s->'byCashier') x where x->>'name'='Budi')=35000 and (select (x->>'sales')::numeric from jsonb_array_elements(s->'byCashier') x where x->>'name'='Sari')=3333, (s->'byCashier')::text);
  perform t_ck('A12 produk terlaris urut: A(2), B, C', s->'top'->0->>'name'='A' and (s->'top'->0->>'qty')::numeric=2 and s->'top'->1->>'name'='B' and s->'top'->2->>'name'='C', (s->'top')::text);
  perform t_ck('A13 harian: 1 hari, 3 bill', jsonb_array_length(s->'daily')=1 and (s->'daily'->0->>'count')::int=3, (s->'daily')::text);
  perform t_ck('A14 per jam terisi', jsonb_array_length(s->'hourly')>=1);

  s := owner_sales_summary(current_setting('t.o1')::uuid,f,t,pf,pt);
  perform t_ck('A15 filter satu outlet: 2 bill / 35000', (s->>'count')::int=2 and (s->>'sales')::numeric=35000, s::text);
  perform t_ck('A16 filter satu outlet: rincian outlet hanya itu', jsonb_array_length(s->'byOutlet')=1);

  perform t_err('A17 outlet bisnis lain ditolak', format($q$select owner_sales_summary(%L,now()-interval '1 day',now(),now()-interval '3 days',now()-interval '1 day')$q$, current_setting('t.o2')), 'Outlet tidak ditemukan');
  perform t_err('A18 rentang terbalik ditolak', $q$select owner_sales_summary(null,now(),now()-interval '1 day',now()-interval '3 days',now()-interval '2 days')$q$, 'Rentang tanggal tidak valid');
  perform t_err('A19 rentang > 400 hari ditolak', $q$select owner_sales_summary(null,now()-interval '500 days',now(),now()-interval '900 days',now()-interval '501 days')$q$, 'Rentang tanggal terlalu panjang');
end $$;
select set_config('request.jwt.claim.sub',:'u2',false);
do $$
declare s jsonb;
begin
  s := owner_sales_summary(null,now()-interval '1 day',now()+interval '1 day',now()-interval '3 days',now()-interval '1 day');
  perform t_ck('A20 owner lain hanya melihat bisnisnya (1 bill / 10000)', (s->>'count')::int=1 and (s->>'sales')::numeric=10000 and jsonb_array_length(s->'byOutlet')=1, s::text);
end $$;
select set_config('request.jwt.claim.sub',:'u3',false);
do $$ begin perform t_err('A21 non-owner ditolak', $q$select owner_sales_summary(null,now()-interval '1 day',now(),now()-interval '3 days',now()-interval '1 day')$q$, 'Hanya owner%'); end $$;

-- B. daftar bill
select set_config('request.jwt.claim.sub',:'u1',false);
do $$
declare r jsonb; f timestamptz := now() - interval '1 day'; t timestamptz := now() + interval '1 day'; num text;
begin
  r := owner_list_bills(null,f,t);
  perform t_ck('B1 default = bill selesai (3)', (r->>'total')::int=3 and jsonb_array_length(r->'rows')=3, r->>'total');
  r := owner_list_bills(null,f,t,'held');
  perform t_ck('B2 bill ditahan = 1', (r->>'total')::int=1);
  r := owner_list_bills(null,f,t,'voided');
  perform t_ck('B3 bill batal = 1 dengan alasan', (r->>'total')::int=1 and r->'rows'->0->>'voidReason'='salah input', r::text);
  r := owner_list_bills(null,f,t,'all');
  perform t_ck('B4 semua = 5', (r->>'total')::int=5, r->>'total');
  r := owner_list_bills(null,f,t,'completed',null,2,0);
  perform t_ck('B5 paginasi: total 3, halaman 2 baris', (r->>'total')::int=3 and jsonb_array_length(r->'rows')=2);
  r := owner_list_bills(null,f,t,'completed',null,2,2);
  perform t_ck('B6 halaman kedua 1 baris', jsonb_array_length(r->'rows')=1);
  r := owner_list_bills(current_setting('t.o1b')::uuid,f,t);
  perform t_ck('B7 filter outlet: 1 bill milik Sari', (r->>'total')::int=1 and r->'rows'->0->>'cashierName'='Sari' and r->'rows'->0->>'outletName'='Outlet 1B', r::text);
  select (owner_list_bills(null,f,t)->'rows'->0->>'number') into num;
  r := owner_list_bills(null,f,t,'completed',substr(num,length(num)-4));
  perform t_ck('B8 cari nomor bill', (r->>'total')::int>=1, r::text);
  r := owner_list_bills(null,f,t,'completed','tidak-ada-yang-cocok');
  perform t_ck('B9 cari tanpa hasil = 0', (r->>'total')::int=0 and jsonb_array_length(r->'rows')=0);
  r := owner_list_bills(null,f,t,'completed',null,9999,0);
  perform t_ck('B10 batas limit 200 (tidak error)', jsonb_array_length(r->'rows')=3);
  perform t_ck('B11 baris memuat metode bayar dan diskon', r->'rows'->0->>'paymentMethod' is not null and r->'rows'->0->>'discount' is not null);
  perform t_err('B12 status tidak valid ditolak', format($q$select owner_list_bills(null,%L,%L,'x')$q$, f, t), 'Status bill tidak valid');
  perform t_err('B13 outlet bisnis lain ditolak', format($q$select owner_list_bills(%L,%L,%L)$q$, current_setting('t.o2'), f, t), 'Outlet tidak ditemukan');
end $$;
select set_config('request.jwt.claim.sub',:'u2',false);
do $$
declare r jsonb;
begin
  r := owner_list_bills(null,now()-interval '1 day',now()+interval '1 day','all');
  perform t_ck('B14 owner lain hanya melihat 1 bill', (r->>'total')::int=1, r::text);
end $$;

-- C. item bill
select set_config('request.jwt.claim.sub',:'u1',false);
do $$
declare it jsonb;
begin
  it := owner_get_bill_items(current_setting('t.bill1')::uuid);
  perform t_ck('C1 item bill: A x2 @10000', jsonb_array_length(it)=1 and it->0->>'productName'='A' and (it->0->>'quantity')::numeric=2 and (it->0->>'unitPrice')::numeric=10000, it::text);
  perform t_err('C2 bill bisnis lain tidak ditemukan', format($q$select owner_get_bill_items(%L)$q$, current_setting('t.bill4')), 'Bill tidak ditemukan');
  perform t_err('C3 bill acak tidak ditemukan', $q$select owner_get_bill_items(gen_random_uuid())$q$, 'Bill tidak ditemukan');
end $$;
select set_config('request.jwt.claim.sub',:'u3',false);
do $$ begin perform t_err('C4 non-owner ditolak', format($q$select owner_get_bill_items(%L)$q$, current_setting('t.bill1')), 'Hanya owner%'); end $$;

-- D. RLS baca langsung
select set_config('request.jwt.claim.sub',:'u1',false);
do $$
begin
  perform t_ck('D1 owner melihat produk outlet tanpa kasir (hanya lewat hak owner)', (select count(*) from products where name='Hanya Owner')=1);
  perform t_ck('D2 owner tidak melihat produk bisnis lain', (select count(*) from products where outlet_id=current_setting('t.o2')::uuid)=0);
  perform t_ck('D3 owner melihat transaksi semua outletnya (5)', (select count(*) from transactions)=5, (select count(*)::text from transactions));
  perform t_ck('D4 owner melihat item dan pembayaran bill-nya', (select count(*) from transaction_items)>=5 and (select count(*) from payments)>=3);
  perform t_ck('D5 owner melihat shift outlet-nya (2)', (select count(*) from shifts)=2);
end $$;
select set_config('request.jwt.claim.sub',:'u2',false);
do $$
begin
  perform t_ck('D6 owner lain: produk hanya outlet sendiri', (select count(*) from products)=1);
  perform t_ck('D7 owner lain: transaksi hanya miliknya (1)', (select count(*) from transactions)=1);
  perform t_ck('D8 owner lain tidak melihat produk outlet 1C', (select count(*) from products where name='Hanya Owner')=0);
end $$;
select set_config('request.jwt.claim.sub',:'u3',false);
do $$ begin perform t_ck('D9 akun tanpa bisnis/kasir tidak melihat apa pun', (select count(*) from products)=0 and (select count(*) from transactions)=0 and (select count(*) from shifts)=0); end $$;

-- E. katalog di outlet tanpa kasir
select set_config('request.jwt.claim.sub',:'u1',false);
do $$
declare cat uuid; p uuid;
begin
  cat := create_category(current_setting('t.o1c')::uuid,'Minuman',1);
  perform t_ck('E1 owner membuat kategori di outlet tanpa kasir', cat is not null);
  p := create_product(current_setting('t.o1c')::uuid,cat,'Kopi',3000,10000,5,'bar');
  perform t_ck('E2 owner membuat produk di outlet tanpa kasir', (select selling_price from products where id=p)=10000);
  perform update_product(p,current_setting('t.o1c')::uuid,cat,'Kopi Susu',3500,12000,7,'bar');
  perform t_ck('E3 owner mengubah produk', (select name||selling_price::text from products where id=p)='Kopi Susu12000.00');
  perform update_category(cat,current_setting('t.o1c')::uuid,'Minuman Dingin',2);
  perform t_ck('E4 owner mengubah kategori', (select name from categories where id=cat)='Minuman Dingin');
  perform delete_product(p,current_setting('t.o1c')::uuid);
  perform delete_category(cat,current_setting('t.o1c')::uuid);
  perform t_ck('E5 owner menghapus produk dan kategori', not exists(select 1 from products where id=p) or (select not is_active from products where id=p));
  -- perilaku lama: akun dengan kasir aktif di outlet
  cat := create_category(current_setting('t.o1')::uuid,'Makanan',1);
  perform t_ck('E6 outlet berkasir tetap bisa (perilaku lama)', cat is not null);
end $$;
select set_config('request.jwt.claim.sub',:'u2',false);
do $$
begin
  perform t_err('E7 owner lain tidak bisa membuat kategori di outlet u1', format($q$select create_category(%L,'X',1)$q$, current_setting('t.o1')), 'Sesi kasir tidak valid');
  perform t_err('E8 owner lain tidak bisa membuat produk di outlet u1', format($q$select create_product(%L,null,'X',1,2,3)$q$, current_setting('t.o1')), 'Sesi kasir tidak valid');
end $$;
select set_config('request.jwt.claim.sub',:'u3',false);
do $$ begin perform t_err('E9 akun tanpa bisnis ditolak', format($q$select create_category(%L,'X',1)$q$, current_setting('t.o1')), 'Sesi kasir tidak valid'); end $$;
select set_config('request.jwt.claim.sub','',false);
do $$ begin perform t_err('E10 tanpa login ditolak', format($q$select create_category(%L,'X',1)$q$, current_setting('t.o1')), 'Belum login'); end $$;

-- F. fungsi internal tidak bisa dipanggil klien
do $$ begin perform t_err('F1 assert_catalog_access tidak bisa dipanggil klien', format($q$select assert_catalog_access(%L)$q$, current_setting('t.o1')), 'permission denied%'); end $$;

reset role;
select name || ' ' || case when ok then 'PASS' else 'FAIL' end || coalesce(' ' || nullif(detail,''), '') from t_chk order by length(name), name;
select 'TOTAL ' || count(*) || ' FAIL ' || count(*) filter (where not ok) from t_chk;
