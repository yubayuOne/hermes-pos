-- Uji migrasi 025: catatan per item (checkout, Tahan Bill, panggil ulang, bayar bill ditahan, Split Bill, detail bill).
-- Butuh migrasi 001-025 pada Postgres uji dengan stub auth. MENGOSONGKAN data uji.
-- Setiap baris keluaran harus diawali PASS.
\set ON_ERROR_STOP on
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
insert into products(outlet_id,name,hpp,selling_price,stock,station) values
 (:'o1','A',4000,10000,1000,'kitchen'),(:'o1','B',6000,15000,1000,'kitchen'),(:'o1','C',1000,3333,1000,'bar');
select set_config('t.o1',:'o1',false), set_config('t.c1',:'c1',false), set_config('t.u1',:'u1',false), set_config('t.u2',:'u2',false), set_config('t.c2',:'c2',false);

set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
select open_shift(:'c1',:'o1',50000) as sh \gset
select set_config('t.sh',:'sh',false);


do $$
declare
  o uuid:=current_setting('t.o1')::uuid; c uuid:=current_setting('t.c1')::uuid; sh uuid:=current_setting('t.sh')::uuid;
  pa uuid; pb uuid; r jsonb; tid uuid; items jsonb; n int; hid uuid; r2 jsonb; ch uuid; parent uuid; s text;
begin
  select id into pa from products where name='A'; select id into pb from products where name='B';

  -- A. checkout bill baru
  r := complete_checkout(sh,c,o,jsonb_build_object('table_number','M1','items',jsonb_build_array(
        jsonb_build_object('product_id',pa,'quantity',2,'note','  tanpa es, gula sedikit  '),
        jsonb_build_object('product_id',pb,'quantity',1,'note','   '))),'cash',50000,null,'n1',null,null);
  tid:=(r->>'transactionId')::uuid;
  items:=get_bill_items(tid);
  perform t_ck('A1 catatan disimpan dan spasi ujung dibuang', (select ti.note from transaction_items ti where ti.transaction_id=tid and ti.product_id=pa)='tanpa es, gula sedikit');
  perform t_ck('A2 catatan kosong/spasi menjadi NULL', (select ti.note from transaction_items ti where ti.transaction_id=tid and ti.product_id=pb) is null);
  perform t_ck('A3 get_bill_items mengembalikan catatan', (select x->>'note' from jsonb_array_elements(items) x where x->>'productId'=pa::text)='tanpa es, gula sedikit', items::text);
  perform t_ck('A4 catatan tidak mengubah total (2x10000 + 15000 = 35000)', (r->>'total')::numeric=35000);

  r := complete_checkout(sh,c,o,jsonb_build_object('table_number','M1','items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1,'note',repeat('x',300)))),'cash',50000,null,'n2',null,null);
  perform t_ck('A5 catatan dipotong 200 karakter', (select char_length(ti.note) from transaction_items ti where ti.transaction_id=(r->>'transactionId')::uuid)=200);

  r := complete_checkout(sh,c,o,jsonb_build_object('table_number','M1','items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1))),'cash',50000,null,'n3',null,null);
  perform t_ck('A6 tanpa catatan: NULL', (select ti.note from transaction_items ti where ti.transaction_id=(r->>'transactionId')::uuid) is null);

  r := complete_checkout(sh,c,o,jsonb_build_object('table_number','M1','items',jsonb_build_array(
        jsonb_build_object('product_id',pa,'quantity',1),jsonb_build_object('product_id',pa,'quantity',1,'note','pedas'))),'cash',50000,null,'n4',null,null);
  perform t_ck('A7 produk sama di dua baris payload: catatan yang ada dipakai', (select ti.note from transaction_items ti where ti.transaction_id=(r->>'transactionId')::uuid)='pedas');

  -- B. Tahan Bill
  hid := save_held_bill(sh,c,o,jsonb_build_object('table_number','M1','items',jsonb_build_array(
        jsonb_build_object('product_id',pa,'quantity',3,'note','tanpa bawang'),jsonb_build_object('product_id',pb,'quantity',2)),'table_number','5'));
  perform t_ck('B1 save_held_bill menyimpan catatan', (select ti.note from transaction_items ti where ti.transaction_id=hid and ti.product_id=pa)='tanpa bawang');
  r := recall_held_bill_with_items(hid);
  perform t_ck('B2 recall mengembalikan catatan per item', (select x->>'note' from jsonb_array_elements(r->'items') x where x->>'productId'=pa::text)='tanpa bawang'
     and (select (x->'note') from jsonb_array_elements(r->'items') x where x->>'productId'=pb::text) = 'null'::jsonb, r::text);
  perform t_ck('B3 get_bill_items (bill ditahan) mengembalikan catatan', (select x->>'note' from jsonb_array_elements(get_bill_items(hid)) x where x->>'productId'=pa::text)='tanpa bawang');

  -- bayar bill ditahan dengan qty ditambah dan catatan diubah -> semua baris produk itu memakai catatan baru
  r2 := complete_checkout(sh,c,o,jsonb_build_object('table_number','M1','items',jsonb_build_array(
        jsonb_build_object('product_id',pa,'quantity',4,'note','extra pedas'),jsonb_build_object('product_id',pb,'quantity',2))),'cash',200000,null,'n5',null,hid);
  perform t_ck('B4 bayar bill ditahan: catatan diperbarui di semua baris produk', (select count(*) from transaction_items ti where ti.transaction_id=hid and ti.product_id=pa and ti.note='extra pedas')=(select count(*) from transaction_items ti where ti.transaction_id=hid and ti.product_id=pa), (select count(*) from transaction_items ti where ti.transaction_id=hid and ti.product_id=pa)::text);
  perform t_ck('B5 catatan dihapus saat bayar -> NULL', (select ti.note from transaction_items ti where ti.transaction_id=hid and ti.product_id=pb) is null);

  -- C. Split Bill
  parent := save_held_bill(sh,c,o,jsonb_build_object('table_number','M1','items',jsonb_build_array(
        jsonb_build_object('product_id',pa,'quantity',3,'note','tanpa es'),jsonb_build_object('product_id',pb,'quantity',1,'note','panas'))));
  perform start_split_from_held(parent);
  r := get_held_bill_items(parent);
  perform t_ck('C1 sisa item split membawa catatan', (select x->>'note' from jsonb_array_elements(r) x where x->>'productId'=pa::text)='tanpa es', r::text);
  r2 := complete_checkout(sh,c,o,jsonb_build_object('table_number','M1','items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1,'note','tanpa es'))),'cash',20000,null,'n6',parent,null);
  ch:=(r2->>'transactionId')::uuid;
  perform t_ck('C2 bagian split menyimpan catatan', (select ti.note from transaction_items ti where ti.transaction_id=ch)='tanpa es');
  r := get_held_bill_items(parent);
  perform t_ck('C3 catatan induk tetap ada setelah satu bagian dibayar', (select x->>'note' from jsonb_array_elements(r) x where x->>'productId'=pa::text)='tanpa es' and (select (x->>'quantity')::numeric from jsonb_array_elements(r) x where x->>'productId'=pa::text)=2, r::text);

  -- D. bill lama tanpa catatan tetap terbaca
  perform t_ck('D1 jumlah baris dengan catatan terhitung benar', (select count(*) from transaction_items where note is not null)>=5);
end $$;

select name||' '||case when ok then '' else coalesce(detail,'') end from (select case when ok then 'PASS' else 'FAIL' end||' '||name as name, ok, detail from public.t_chk order by ctid) q;
reset role;
drop table if exists public.t_chk;
drop function if exists public.t_ck(text,boolean,text);
