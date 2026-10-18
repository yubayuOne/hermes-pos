-- Uji migrasi 029: produk dengan dan tanpa stok (track_stock).
-- Butuh migrasi 001-029 pada Postgres uji dengan stub auth. MENGOSONGKAN data uji.
-- Setiap baris keluaran harus diawali PASS.
\set ON_ERROR_STOP on
-- 032 hides void_transaction behind the owner approval code. This helper keeps the void rules under test.
reset role;
create or replace function public.t_void(p uuid, r text) returns jsonb language sql security definer set search_path = public as $$ select public.void_transaction(p, r) $$;
grant execute on function public.t_void(uuid, text) to authenticated;
\pset tuples_only on
reset role;
truncate transactions, transaction_items, payments, shifts, held_bills, cash_ledger, products, categories, cashier_sessions, outlets cascade;
delete from auth.users;
drop table if exists public.t_chk;
create table public.t_chk(name text, ok boolean, detail text);
grant all on public.t_chk to authenticated;
create or replace function public.t_ck(n text, c boolean, d text default '') returns void language sql as $$ insert into public.t_chk values(n, coalesce(c,false), d) $$;
grant execute on function public.t_ck(text,boolean,text) to authenticated;
select gen_random_uuid() as u1 \gset
select gen_random_uuid() as u2 \gset
select gen_random_uuid() as c1 \gset
select gen_random_uuid() as c2 \gset
select gen_random_uuid() as o1 \gset
insert into auth.users values(:'u1'),(:'u2');
insert into outlets(id,name) values(:'o1','Outlet A');
insert into cashier_sessions(auth_user_id,cashier_id,outlet_id,cashier_name,outlet_name,terminal_name,is_active) values
 (:'u1',:'c1',:'o1','K1','Outlet A','T1',true),(:'u2',:'c2',:'o1','K2','Outlet A','T2',true);
select set_config('t.o1',:'o1',false), set_config('t.c1',:'c1',false), set_config('t.u1',:'u1',false);
set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
select open_shift(:'c1',:'o1',50000) as sh \gset
select set_config('t.sh',:'sh',false);

do $$
declare
  o uuid:=current_setting('t.o1')::uuid; c uuid:=current_setting('t.c1')::uuid; sh uuid:=current_setting('t.sh')::uuid;
  pt uuid; pu uuid; pd uuid; r jsonb; tid uuid; hid uuid; ok boolean; msg text; items jsonb;
begin
  -- Produk dibuat lewat RPC: dilacak (stok 2), tanpa stok (stok diisi 50 tapi harus diabaikan), dan tanpa parameter (default)
  pt := create_product(o, null, 'Dilacak', 1000, 5000, 2, 'kitchen', true);
  pu := create_product(o, null, 'TanpaStok', 1000, 7000, 50, 'bar', false);
  pd := create_product(o, null, 'Default', 1000, 3000, 4, 'kitchen');
  perform t_ck('E1 create_product tanpa stok: track_stock=false', (select track_stock from products where id=pu)=false);
  perform t_ck('E2 create_product tanpa stok: stok disimpan 0', (select stock from products where id=pu)=0);
  perform t_ck('E3 create_product dilacak menyimpan stok', (select track_stock and stock=2 from products where id=pt));
  perform t_ck('E4 parameter p_track_stock default true', (select track_stock and stock=4 from products where id=pd));

  -- A. produk dilacak tetap dibatasi stok
  ok := true;
  begin
    perform complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pt,'quantity',3))),'cash',50000,null,'a1',null,null);
    ok := false;
  exception when others then msg := sqlerrm; end;
  perform t_ck('A1 stok kurang ditolak untuk produk dilacak', ok and msg like '%Stok produk tidak mencukupi%', coalesce(msg,''));
  perform complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pt,'quantity',2))),'cash',50000,null,'a2',null,null);
  perform t_ck('A2 stok produk dilacak berkurang menjadi 0', (select stock from products where id=pt)=0);

  -- B. produk tanpa stok boleh dijual berapa pun dan stoknya tidak bergerak
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pu,'quantity',5))),'cash',100000,null,'b1',null,null);
  perform t_ck('B1 produk tanpa stok terjual walau stok 0', (r->>'total')::numeric=35000, r::text);
  perform t_ck('B2 stok produk tanpa stok tetap 0 (tidak negatif)', (select stock from products where id=pu)=0);
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pu,'quantity',2),jsonb_build_object('product_id',pd,'quantity',1))),'cash',50000,null,'b2',null,null);
  perform t_ck('B3 campuran: total benar (2x7000 + 3000)', (r->>'total')::numeric=17000);
  perform t_ck('B4 campuran: hanya produk dilacak yang berkurang', (select stock from products where id=pd)=3 and (select stock from products where id=pu)=0);

  -- C. bill ditahan lalu dibayar
  hid := save_held_bill(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pu,'quantity',9)),'table_number','3'));
  perform t_ck('C1 Tahan Bill produk tanpa stok berhasil', hid is not null);
  items := get_held_bill_items(hid);
  perform t_ck('C2 get_held_bill_items membawa trackStock=false', (items->0->>'trackStock')='false', items::text);
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pu,'quantity',12))),'cash',200000,null,'c1',null,hid);
  perform t_ck('C3 bayar bill ditahan dengan qty lebih besar (tanpa stok) berhasil', (r->>'total')::numeric=84000, r::text);
  perform t_ck('C4 stok tetap 0 setelah bayar bill ditahan', (select stock from products where id=pu)=0);

  -- D. batalkan bill
  tid := (complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pu,'quantity',2),jsonb_build_object('product_id',pd,'quantity',2))),'cash',50000,null,'d1',null,null)->>'transactionId')::uuid;
  perform t_ck('D1 sebelum batal: stok dilacak 1', (select stock from products where id=pd)=1);
  perform t_void(tid,'salah input');
  perform t_ck('D2 batal bill: stok dilacak kembali ke 3', (select stock from products where id=pd)=3);
  perform t_ck('D3 batal bill: stok tanpa stok tetap 0 (tidak naik)', (select stock from products where id=pu)=0);

  -- F. update_product mengganti mode
  perform update_product(pu, o, null, 'TanpaStok', 1000, 7000, 7, 'bar', true);
  perform t_ck('F1 update ke dilacak memakai stok baru', (select track_stock and stock=7 from products where id=pu));
  perform update_product(pu, o, null, 'TanpaStok', 1000, 7000, 7, 'bar', false);
  perform t_ck('F2 update ke tanpa stok mengosongkan stok', (select not track_stock and stock=0 from products where id=pu));
  ok := true;
  begin
    perform update_product(pt, o, null, 'Dilacak', 1000, 5000, -1, 'kitchen', true);
    ok := false;
  exception when others then null; end;
  perform t_ck('F3 stok negatif tetap ditolak', ok);
end $$;

reset role;
select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else ' :: ' || coalesce(detail,'') end from public.t_chk order by ctid;
select 'TOTAL ' || count(*) || ' ok=' || count(*) filter (where ok) from public.t_chk;
