-- Uji migrasi 026: PIN kasir, banyak kasir per akun, kunci setelah 5 kali salah, hash tidak terbaca klien.
-- Butuh migrasi 001-026 pada Postgres uji dengan stub auth. MENGOSONGKAN data uji.
-- Setiap baris keluaran harus diawali PASS.
\set ON_ERROR_STOP on
\pset tuples_only on
reset role;
create extension if not exists pgcrypto;
-- setup_db.py memberi "grant all ... to authenticated" sesudah migrasi; ulangi pembatasan kolom dari migrasi 026.
revoke select on public.cashier_sessions from anon, authenticated;
grant select (id, auth_user_id, cashier_id, outlet_id, cashier_name, outlet_name, terminal_name, is_active, created_at) on public.cashier_sessions to authenticated;
truncate transactions, transaction_items, payments, shifts, held_bills, cash_ledger, products, categories, cashier_sessions, outlets cascade;
delete from auth.users;
drop table if exists public.t_chk;
create table public.t_chk(name text, ok boolean, detail text);
grant all on public.t_chk to authenticated;
create or replace function public.t_ck(n text, c boolean, d text default '') returns void language sql as $$ insert into public.t_chk values(n, coalesce(c,false), d) $$;
grant execute on function public.t_ck(text,boolean,text) to authenticated;
select gen_random_uuid() as u1 \gset
select gen_random_uuid() as u2 \gset
select gen_random_uuid() as o1 \gset
select gen_random_uuid() as o2 \gset
insert into auth.users values(:'u1'),(:'u2');
insert into outlets(id,name) values(:'o1','Outlet A'),(:'o2','Outlet B');

-- A. pendaftaran kasir lewat admin_create_cashier (postgres = peran admin)
select admin_create_cashier(:'u1',:'o1','Budi','123456') as c1 \gset
select admin_create_cashier(:'u1',:'o1','Sari','654321','POS 2') as c2 \gset
select admin_create_cashier(:'u2',:'o2','Dewi','111111') as c3 \gset
select set_config('t.o1',:'o1',false), set_config('t.o2',:'o2',false), set_config('t.c1',:'c1',false), set_config('t.c2',:'c2',false), set_config('t.c3',:'c3',false), set_config('t.u1',:'u1',false);
do $$ begin
  perform t_ck('A1 satu akun punya 2 kasir aktif', (select count(*) from cashier_sessions where auth_user_id=current_setting('t.u1')::uuid and is_active)=2);
  perform t_ck('A2 PIN tersimpan sebagai hash bcrypt, bukan teks', (select pin_hash like '$2%' and pin_hash<>'123456' from cashier_sessions where cashier_id=current_setting('t.c1')::uuid));
  begin perform admin_create_cashier(current_setting('t.u1')::uuid, (select id from outlets where name='Outlet A'), 'budi', '222222'); perform t_ck('A3 nama kasir kembar ditolak', false);
  exception when unique_violation then perform t_ck('A3 nama kasir kembar ditolak', true); end;
  begin perform admin_create_cashier(current_setting('t.u1')::uuid, (select id from outlets where name='Outlet A'), 'Tono', '12345'); perform t_ck('A4 PIN bukan 6 angka ditolak', false);
  exception when others then perform t_ck('A4 PIN bukan 6 angka ditolak', sqlerrm='PIN harus 6 angka', sqlerrm); end;
  begin perform admin_create_cashier(current_setting('t.u1')::uuid, (select id from outlets where name='Outlet A'), 'Tono', '12a456'); perform t_ck('A5 PIN berisi huruf ditolak', false);
  exception when others then perform t_ck('A5 PIN berisi huruf ditolak', sqlerrm='PIN harus 6 angka', sqlerrm); end;
end $$;

-- B. akun u1 login di perangkat
set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
do $$
declare r jsonb; n int; l record;
begin
  select count(*) into n from list_device_cashiers();
  perform t_ck('B1 daftar hanya kasir milik akun (2)', n=2, n::text);
  select * into l from list_device_cashiers() where cashier_name='Budi';
  perform t_ck('B2 daftar memuat outlet dan has_pin', l.outlet_name='Outlet A' and l.has_pin and l.terminal_name='POS 1');
  perform t_ck('B3 urut menurut nama', (select cashier_name from list_device_cashiers() limit 1)='Budi');

  r := verify_cashier_pin(current_setting('t.c1')::uuid,'123456');
  perform t_ck('B4 PIN benar', (r->>'ok')::boolean, r::text);
  r := verify_cashier_pin(current_setting('t.c1')::uuid,'000000');
  perform t_ck('B5 PIN salah: sisa percobaan 4', not (r->>'ok')::boolean and r->>'reason'='wrong' and (r->>'attempts_left')::int=4, r::text);
  r := verify_cashier_pin(current_setting('t.c1')::uuid,'123456');
  perform t_ck('B6 PIN benar mengatur ulang hitungan salah', (r->>'ok')::boolean);
  r := verify_cashier_pin(current_setting('t.c1')::uuid,'000000');
  perform t_ck('B7 setelah reset sisa kembali 4', (r->>'attempts_left')::int=4, r::text);

  r := verify_cashier_pin(current_setting('t.c3')::uuid,'111111');
  perform t_ck('B8 kasir milik akun lain tidak ditemukan', r->>'reason'='not_found', r::text);
  r := verify_cashier_pin(gen_random_uuid(),'111111');
  perform t_ck('B9 kasir acak tidak ditemukan', r->>'reason'='not_found', r::text);
  r := verify_cashier_pin(current_setting('t.c2')::uuid,null);
  perform t_ck('B10 PIN kosong ditolak tanpa error', not (r->>'ok')::boolean and r->>'reason'='wrong', r::text);
end $$;

-- C. kunci setelah 5 kali salah (hitungan harus tersimpan walau salah)
do $$
declare r jsonb; i int; c uuid:=current_setting('t.c2')::uuid;
begin
  -- B10 sudah 1 salah pada kasir c2
  for i in 1..3 loop r := verify_cashier_pin(c,'000000'); end loop;
  perform t_ck('C1 salah ke-4: sisa 1', (r->>'attempts_left')::int=1, r::text);
  r := verify_cashier_pin(c,'000000');
  perform t_ck('C2 salah ke-5 mengunci', r->>'reason'='locked' and r->>'locked_until' is not null, r::text);
  r := verify_cashier_pin(c,'654321');
  perform t_ck('C3 PIN benar tetap ditolak saat terkunci', not (r->>'ok')::boolean and r->>'reason'='locked', r::text);
end $$;
reset role;
update cashier_sessions set pin_locked_until=now()-interval '1 second' where cashier_id=current_setting('t.c2')::uuid;
set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
do $$
declare r jsonb;
begin
  r := verify_cashier_pin(current_setting('t.c2')::uuid,'654321');
  perform t_ck('C4 kunci kedaluwarsa: PIN benar masuk', (r->>'ok')::boolean, r::text);
end $$;

-- D. hak akses
do $$
declare v text;
begin
  begin execute 'select pin_hash from cashier_sessions limit 1'; perform t_ck('D1 klien tidak bisa membaca pin_hash', false);
  exception when insufficient_privilege then perform t_ck('D1 klien tidak bisa membaca pin_hash', true); end;
  begin execute 'select * from cashier_sessions limit 1'; perform t_ck('D2 select * ditolak', false);
  exception when insufficient_privilege then perform t_ck('D2 select * ditolak', true); end;
  perform t_ck('D3 kolom biasa tetap terbaca', (select count(*) from (select cashier_id, cashier_name, outlet_id from cashier_sessions) x)=2);
  begin perform set_cashier_pin(current_setting('t.c1')::uuid,'999999'); perform t_ck('D4 klien tidak bisa set_cashier_pin', false);
  exception when insufficient_privilege then perform t_ck('D4 klien tidak bisa set_cashier_pin', true); end;
  begin perform admin_create_cashier(current_setting('t.u1')::uuid, (select id from outlets limit 1), 'X', '123456'); perform t_ck('D5 klien tidak bisa admin_create_cashier', false);
  exception when insufficient_privilege then perform t_ck('D5 klien tidak bisa admin_create_cashier', true); end;
end $$;

-- E. kasir tanpa PIN, ganti PIN, kasir nonaktif, alur transaksi dengan banyak kasir
reset role;
insert into cashier_sessions(auth_user_id,outlet_id,cashier_name,outlet_name) values(:'u1',:'o1','Tanpa PIN','Outlet A');
select cashier_id as c4 from cashier_sessions where cashier_name='Tanpa PIN' \gset
select set_config('t.c4',:'c4',false);
set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
do $$
declare r jsonb;
begin
  r := verify_cashier_pin(current_setting('t.c4')::uuid,'123456');
  perform t_ck('E1 kasir tanpa PIN: no_pin', r->>'reason'='no_pin', r::text);
  perform t_ck('E2 daftar menandai has_pin=false', not (select has_pin from list_device_cashiers() where cashier_name='Tanpa PIN'));
end $$;
reset role;
select set_cashier_pin(:'c4','246810');
update cashier_sessions set is_active=false where cashier_id=:'c2';
set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
do $$
declare r jsonb;
begin
  r := verify_cashier_pin(current_setting('t.c4')::uuid,'246810');
  perform t_ck('E3 PIN baru dari set_cashier_pin berlaku', (r->>'ok')::boolean, r::text);
  perform t_ck('E4 kasir nonaktif hilang dari daftar', (select count(*) from list_device_cashiers() where cashier_name='Sari')=0);
  r := verify_cashier_pin(current_setting('t.c2')::uuid,'654321');
  perform t_ck('E5 kasir nonaktif tidak bisa verifikasi', r->>'reason'='not_found', r::text);
end $$;
set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
select open_shift(:'c1',:'o1',50000) as sh1 \gset
select open_shift(:'c4',:'o1',20000) as sh4 \gset
do $$
begin
  perform t_ck('E6 dua kasir satu akun punya shift terbuka masing-masing', (select count(*) from shifts where status='open')=2);
  begin perform open_shift(current_setting('t.c1')::uuid,current_setting('t.o1')::uuid,1); perform t_ck('E7 shift ganda untuk kasir yang sama ditolak', false);
  exception when others then perform t_ck('E7 shift ganda untuk kasir yang sama ditolak', sqlerrm like 'Masih ada shift aktif%', sqlerrm); end;
  begin perform open_shift(current_setting('t.c3')::uuid,current_setting('t.o2')::uuid,1); perform t_ck('E8 akun tidak bisa memakai kasir milik akun lain', false);
  exception when others then perform t_ck('E8 akun tidak bisa memakai kasir milik akun lain', sqlerrm='Sesi kasir tidak valid', sqlerrm); end;
end $$;

reset role;
select name || ' ' || case when ok then 'PASS' else 'FAIL' end || coalesce(' ' || nullif(detail,''), '') from t_chk order by name;
select 'TOTAL ' || count(*) || ' FAIL ' || count(*) filter (where not ok) from t_chk;
