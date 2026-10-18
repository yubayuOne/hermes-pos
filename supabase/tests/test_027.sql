-- Uji migrasi 027: bisnis owner, pendaftaran, RPC kelola outlet/kasir oleh owner, RLS, backfill data lama.
-- Butuh migrasi 001-027 pada Postgres uji dengan stub auth. MENGOSONGKAN data uji.
-- Setiap baris keluaran harus diawali dengan nama uji dan berakhir PASS.
\set ON_ERROR_STOP on
\pset tuples_only on
reset role;
create extension if not exists pgcrypto;
revoke select on public.cashier_sessions from anon, authenticated;
grant select (id, auth_user_id, cashier_id, outlet_id, cashier_name, outlet_name, terminal_name, is_active, created_at) on public.cashier_sessions to authenticated;
-- Meniru default Supabase: tabel baru di public otomatis dapat hak penuh untuk authenticated; RLS yang menahan.
grant all on public.businesses, public.business_members to authenticated;
truncate transactions, transaction_items, payments, shifts, held_bills, cash_ledger, products, categories, cashier_sessions, outlets, business_members, businesses cascade;
delete from auth.users;
drop table if exists public.t_chk;
create table public.t_chk(name text, ok boolean, detail text);
grant all on public.t_chk to authenticated;
create or replace function public.t_ck(n text, c boolean, d text default '') returns void language sql as $$ insert into public.t_chk values(n, coalesce(c,false), d) $$;
grant execute on function public.t_ck(text,boolean,text) to authenticated;
-- t_err: jalankan SQL, harapkan error dengan pesan tertentu
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

-- A. pendaftaran owner (u1)
set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
select (register_business('  Warung Kopi  ','Cabang Pusat','0812')->>'outlet_id') as o1 \gset
select set_config('t.o1',:'o1',false);
do $$
begin
  perform t_ck('A1 bisnis dan owner terbentuk', (select count(*) from business_members where auth_user_id=current_setting('t.u1')::uuid and role='owner')=1);
  perform t_ck('A2 nama bisnis dirapikan', (select name from businesses)='Warung Kopi');
  perform t_ck('A3 outlet pertama tertaut ke bisnis', (select business_id from outlets where id=current_setting('t.o1')::uuid)=my_business_id());
  perform t_err('A4 daftar dua kali ditolak', $q$select register_business('X','Y')$q$, 'Akun ini sudah memiliki bisnis');
end $$;
select set_config('request.jwt.claim.sub',:'u2',false);
do $$
begin
  perform t_err('A5 nama bisnis kosong ditolak', $q$select register_business('  ','Y')$q$, 'Nama bisnis wajib diisi');
  perform t_err('A6 nama outlet kosong ditolak', $q$select register_business('X','')$q$, 'Nama outlet wajib diisi');
  perform t_ck('A7 gagal daftar tidak meninggalkan data', (select count(*) from business_members where auth_user_id=current_setting('t.u2')::uuid)=0);
  perform t_err('A8 non-owner tidak boleh membuat kasir', format($q$select owner_create_cashier(%L,'Budi','123456')$q$, current_setting('t.o1')), 'Hanya owner%');
  perform t_err('A9 non-owner tidak boleh melihat daftar kasir', $q$select * from owner_list_cashiers()$q$, 'Hanya owner%');
end $$;
select set_config('request.jwt.claim.sub','',false);
do $$ begin perform t_err('A10 tanpa login ditolak', $q$select register_business('X','Y')$q$, 'Belum login'); end $$;

-- B. owner u1 mengelola kasir
select set_config('request.jwt.claim.sub',:'u1',false);
-- 030 limits a trial to one outlet and two cashiers; this test needs more, so the business gets a paid plan with extra outlets.
reset role;
update public.subscriptions set plan_code = 'monthly', extra_outlets = 2, expires_at = now() + interval '30 days';
set role authenticated;
select owner_create_cashier(:'o1','Budi','123456','Kasir 1') as c1 \gset
select owner_create_cashier(:'o1','Sari','654321') as c2 \gset
select set_config('t.c1',:'c1',false), set_config('t.c2',:'c2',false);
do $$
declare r jsonb;
begin
  perform t_ck('B1 kasir muncul di layar POS (list_device_cashiers)', (select count(*) from list_device_cashiers())=2);
  r := verify_cashier_pin(current_setting('t.c1')::uuid,'123456');
  perform t_ck('B2 PIN yang dibuat owner berlaku di POS', (r->>'ok')::boolean, r::text);
  perform t_ck('B3 terminal tersimpan', (select terminal_name from list_device_cashiers() where cashier_name='Budi')='Kasir 1');
  perform t_ck('B4 terminal default POS 1', (select terminal_name from list_device_cashiers() where cashier_name='Sari')='POS 1');
  perform t_err('B5 nama kembar ditolak', format($q$select owner_create_cashier(%L,'budi','111111')$q$, current_setting('t.o1')), 'Nama kasir sudah dipakai');
  perform t_err('B6 PIN bukan 6 angka ditolak', format($q$select owner_create_cashier(%L,'Tono','1234')$q$, current_setting('t.o1')), 'PIN harus 6 angka');
  perform t_err('B7 nama kosong ditolak', format($q$select owner_create_cashier(%L,' ','123456')$q$, current_setting('t.o1')), 'Nama kasir wajib diisi');
  perform t_err('B8 outlet acak ditolak', $q$select owner_create_cashier(gen_random_uuid(),'Tono','123456')$q$, 'Outlet tidak ditemukan');
end $$;

-- C. ganti PIN, nonaktif, ubah kasir
do $$
declare r jsonb; i int;
begin
  for i in 1..5 loop r := verify_cashier_pin(current_setting('t.c1')::uuid,'000000'); end loop;
  perform t_ck('C1 kasir terkunci setelah 5 salah', r->>'reason'='locked', r::text);
  perform t_ck('C2 owner melihat status terkunci', (select locked_until is not null from owner_list_cashiers() where cashier_name='Budi'));
  perform owner_set_cashier_pin(current_setting('t.c1')::uuid,'222222');
  r := verify_cashier_pin(current_setting('t.c1')::uuid,'222222');
  perform t_ck('C3 ganti PIN membuka kunci dan PIN baru berlaku', (r->>'ok')::boolean, r::text);
  r := verify_cashier_pin(current_setting('t.c1')::uuid,'123456');
  perform t_ck('C4 PIN lama tidak berlaku', not (r->>'ok')::boolean, r::text);
  perform t_err('C5 PIN baru harus 6 angka', format($q$select owner_set_cashier_pin(%L,'12')$q$, current_setting('t.c1')), 'PIN harus 6 angka');

  perform owner_set_cashier_active(current_setting('t.c2')::uuid,false);
  perform t_ck('C6 kasir nonaktif hilang dari POS', (select count(*) from list_device_cashiers())=1);
  perform t_ck('C7 owner masih melihat kasir nonaktif', (select not is_active from owner_list_cashiers() where cashier_name='Sari'));
  perform owner_set_cashier_active(current_setting('t.c2')::uuid,true);
  perform t_ck('C8 aktif lagi muncul di POS', (select count(*) from list_device_cashiers())=2);

  perform owner_update_cashier(current_setting('t.c2')::uuid,'Sari Dewi',current_setting('t.o1')::uuid,'POS 2');
  perform t_ck('C9 ubah nama dan terminal', (select terminal_name from list_device_cashiers() where cashier_name='Sari Dewi')='POS 2');
  perform t_err('C10 ubah ke nama yang sudah dipakai ditolak', format($q$select owner_update_cashier(%L,'Budi',%L)$q$, current_setting('t.c2'), current_setting('t.o1')), 'Nama kasir sudah dipakai');
  perform t_err('C11 kasir acak tidak ditemukan', $q$select owner_set_cashier_pin(gen_random_uuid(),'123456')$q$, 'Kasir tidak ditemukan');
end $$;

-- D. outlet kedua + pindah kasir
select owner_create_outlet('Cabang Timur','Jl. Timur 1','0813') as o2 \gset
select set_config('t.o2',:'o2',false);
do $$
begin
  perform t_ck('D1 outlet baru milik bisnis owner', (select business_id from outlets where id=current_setting('t.o2')::uuid)=my_business_id());
  perform owner_update_cashier(current_setting('t.c2')::uuid,'Sari Dewi',current_setting('t.o2')::uuid,'POS 2');
  perform t_ck('D2 kasir pindah outlet (nama outlet ikut)', (select outlet_name from list_device_cashiers() where cashier_name='Sari Dewi')='Cabang Timur');
  perform owner_update_outlet(current_setting('t.o2')::uuid,'Cabang Timur Baru','Jl. Timur 2','0814',true);
  perform t_ck('D3 ubah nama outlet menyalin nama ke kasir', (select outlet_name from list_device_cashiers() where cashier_name='Sari Dewi')='Cabang Timur Baru');
  perform t_ck('D4 owner melihat semua kasir lintas outlet', (select count(*) from owner_list_cashiers())=2);
  perform t_err('D5 nama outlet kosong ditolak', $q$select owner_create_outlet('')$q$, 'Nama outlet wajib diisi');
end $$;
select set_config('t.bid', (select my_business_id()::text), false);

-- E. owner lain (u3) tidak bisa menyentuh data u1
select set_config('request.jwt.claim.sub',:'u3',false);
select (register_business('Toko Lain','Outlet Lain')->>'outlet_id') as o3 \gset
select set_config('t.o3',:'o3',false);
do $$
begin
  perform t_ck('E1 owner lain tidak melihat kasir u1', (select count(*) from owner_list_cashiers())=0);
  perform t_err('E2 tidak bisa mengganti PIN kasir u1', format($q$select owner_set_cashier_pin(%L,'999999')$q$, current_setting('t.c1')), 'Kasir tidak ditemukan');
  perform t_err('E3 tidak bisa menonaktifkan kasir u1', format($q$select owner_set_cashier_active(%L,false)$q$, current_setting('t.c1')), 'Kasir tidak ditemukan');
  perform t_err('E4 tidak bisa mengubah kasir u1', format($q$select owner_update_cashier(%L,'X',%L)$q$, current_setting('t.c1'), current_setting('t.o3')), 'Kasir tidak ditemukan');
  perform t_err('E5 tidak bisa membuat kasir di outlet u1', format($q$select owner_create_cashier(%L,'Maling','123456')$q$, current_setting('t.o1')), 'Outlet tidak ditemukan');
  perform t_err('E6 tidak bisa mengubah outlet u1', format($q$select owner_update_outlet(%L,'Hack')$q$, current_setting('t.o1')), 'Outlet tidak ditemukan');
  perform t_ck('E7 RLS: hanya melihat bisnis sendiri', (select count(*) from businesses)=1 and (select name from businesses)='Toko Lain');
  perform t_ck('E8 RLS: hanya melihat outlet bisnis sendiri', (select count(*) from outlets)=1);
  perform t_ck('E9 RLS: hanya melihat keanggotaan sendiri', (select count(*) from business_members)=1);
  perform t_ck('E10 daftar kasir POS u3 kosong', (select count(*) from list_device_cashiers())=0);
  perform t_err('E11 insert langsung ke businesses ditolak', $q$insert into businesses(name) values('x')$q$, '%row-level security%');
  perform t_err('E12 insert langsung ke business_members ditolak', format($q$insert into business_members(business_id,auth_user_id) values(%L,%L)$q$, current_setting('t.bid'), current_setting('t.u3')), '%row-level security%');
  perform t_err('E13 require_owner_business tidak bisa dipanggil klien', $q$select require_owner_business()$q$, 'permission denied%');
  perform t_err('E14 backfill_businesses tidak bisa dipanggil klien', $q$select backfill_businesses()$q$, 'permission denied%');
end $$;

-- F. backfill data lama: akun dengan kasir tetapi belum punya bisnis
reset role;
select gen_random_uuid() as u4 \gset
select gen_random_uuid() as o4 \gset
select gen_random_uuid() as o5 \gset
select gen_random_uuid() as o6 \gset
insert into auth.users values(:'u4');
insert into outlets(id,name) values(:'o4','Lama A'),(:'o5','Lama B'),(:'o6','Tanpa Kasir');
insert into cashier_sessions(auth_user_id,outlet_id,cashier_name,outlet_name) values(:'u4',:'o4','K1','Lama A'),(:'u4',:'o5','K2','Lama B');
-- backfill ran inside 027, before the 030 plan limits existed. Triggers are off here so the old rule is what is tested.
set session_replication_role = replica;
select backfill_businesses() as n1 \gset
set session_replication_role = origin;
select set_config('t.n1',:'n1',false);
do $$
declare bid uuid; u uuid := (select auth_user_id from cashier_sessions where cashier_name='K1');
begin
  perform t_ck('F1 backfill membuat 1 bisnis untuk akun lama', current_setting('t.n1')::int = 1, current_setting('t.n1'));
  select business_id into bid from business_members where auth_user_id=u;
  perform t_ck('F2 akun lama jadi owner', bid is not null);
  perform t_ck('F3 semua outlet milik akun tertaut ke satu bisnis', (select count(*) from outlets where business_id=bid)=2);
  perform t_ck('F4 outlet tanpa kasir tidak tersentuh', (select business_id from outlets where name='Tanpa Kasir') is null);
  perform t_ck('F5 bisnis yang sudah ada tidak diubah', (select count(*) from businesses)=3);
end $$;
select backfill_businesses() as n2 \gset
select t_ck('F6 backfill aman diulang (0 baru)', :'n2'::int = 0, :'n2');

reset role;
select name || ' ' || case when ok then 'PASS' else 'FAIL' end || coalesce(' ' || nullif(detail,''), '') from t_chk order by length(name), name;
select 'TOTAL ' || count(*) || ' FAIL ' || count(*) filter (where not ok) from t_chk;
