-- Uji migrasi 022-024: diskon (item & bill), Tahan Bill idempoten, Split Bill dengan diskon, Batal Bill, laporan.
-- Butuh migrasi 001-024 pada Postgres uji dengan stub auth. MENGOSONGKAN data uji.
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
insert into products(outlet_id,name,hpp,selling_price,stock,station) values
 (:'o1','A',4000,10000,1000,'kitchen'),(:'o1','B',6000,15000,1000,'kitchen'),(:'o1','C',1000,3333,1000,'bar');
select set_config('t.o1',:'o1',false), set_config('t.c1',:'c1',false), set_config('t.u1',:'u1',false), set_config('t.u2',:'u2',false), set_config('t.c2',:'c2',false);

set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
select open_shift(:'c1',:'o1',50000) as sh \gset
select set_config('t.sh',:'sh',false);

-- ===================== A. Diskon pada checkout bill baru =====================
do $$
declare
  o uuid:=current_setting('t.o1')::uuid; c uuid:=current_setting('t.c1')::uuid; sh uuid:=current_setting('t.sh')::uuid;
  pa uuid; pb uuid; pc uuid; r jsonb; r2 jsonb; tx transactions%rowtype; err text; st numeric; st2 numeric; payload jsonb;
begin
  select id into pa from products where name='A'; select id into pb from products where name='B'; select id into pc from products where name='C';

  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',2))),'cash',20000,null,'a1',null,null);
  select * into tx from transactions where id=(r->>'transactionId')::uuid;
  perform t_ck('A1 tanpa diskon: subtotal=total, diskon 0', tx.subtotal=20000 and tx.total=20000 and tx.item_discount=0 and tx.bill_discount=0);

  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',3,'discount_type','percent','discount_value',10))),'cash',30000,null,'a2',null,null);
  select * into tx from transactions where id=(r->>'transactionId')::uuid;
  perform t_ck('A2 diskon item 10% pada 3x10000 = 3000, total 27000, kembalian 3000', tx.item_discount=3000 and tx.total=27000 and (r->>'change')::numeric=3000, tx.total::text);

  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pb,'quantity',1,'discount_type','amount','discount_value',5000))),'qris',0,null,'a3',null,null);
  perform t_ck('A3 diskon item nominal 5000 pada 15000 = 10000', (r->>'total')::numeric=10000);

  r := complete_checkout(sh,c,o,jsonb_build_object(
        'items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',2,'discount_type','percent','discount_value',10),jsonb_build_object('product_id',pb,'quantity',1)),
        'bill_discount_type','percent','bill_discount_value',5),'cash',40000,null,'a4',null,null);
  select * into tx from transactions where id=(r->>'transactionId')::uuid;
  perform t_ck('A4 item 10% (2000) + bill 5% dari 33000 (1650) = 31350', tx.subtotal=35000 and tx.item_discount=2000 and tx.bill_discount=1650 and tx.total=31350 and tx.bill_discount_type='percent', tx.total::text);
  perform t_ck('A4 kembalian dihitung dari total setelah diskon', (r->>'change')::numeric=8650);

  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pc,'quantity',3,'discount_type','percent','discount_value',15))),'cash',9999,null,'a5',null,null);
  perform t_ck('A5 pembulatan: 15% dari 9999 = 1499.85 -> 1500, total 8499', (r->>'total')::numeric=8499);

  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pc,'quantity',3,'discount_type','percent','discount_value',12.5))),'cash',9999,null,'a5b',null,null);
  perform t_ck('A5b persen desimal 12.5% dari 9999 = 1249.875 -> 1250, total 8749', (r->>'total')::numeric=8749);

  begin perform complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1,'discount_type','percent','discount_value',101))),'cash',99999,null,'e1',null,null); err:=null; exception when others then err:=sqlerrm; end;
  perform t_ck('A6 persen > 100 ditolak', err like '%tidak boleh lebih dari 100%', coalesce(err,'(tidak error)'));
  begin perform complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1,'discount_type','amount','discount_value',10001))),'cash',99999,null,'e2',null,null); err:=null; exception when others then err:=sqlerrm; end;
  perform t_ck('A7 diskon item nominal melebihi harga ditolak', err like '%melebihi harga%', coalesce(err,'(tidak error)'));
  begin perform complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1)),'bill_discount_type','percent','bill_discount_value',100),'cash',99999,null,'e3',null,null); err:=null; exception when others then err:=sqlerrm; end;
  perform t_ck('A8 diskon yang membuat total 0 ditolak', err like '%total menjadi nol%', coalesce(err,'(tidak error)'));
  begin perform complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1,'discount_type','bogus','discount_value',5))),'cash',99999,null,'e4',null,null); err:=null; exception when others then err:=sqlerrm; end;
  perform t_ck('A9 jenis diskon tidak dikenal ditolak', err like '%Jenis diskon tidak valid%', coalesce(err,'(tidak error)'));
  begin perform complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',2,'discount_type','percent','discount_value',50))),'cash',9999,null,'e5',null,null); err:=null; exception when others then err:=sqlerrm; end;
  perform t_ck('A10 uang kurang dibanding TOTAL SETELAH DISKON ditolak (10000)', err like '%Uang diterima kurang%', coalesce(err,'(tidak error)'));
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',2,'discount_type','percent','discount_value',50))),'cash',10000,null,'e6',null,null);
  perform t_ck('A11 uang pas dengan total setelah diskon diterima', (r->>'change')::numeric=0);

  -- idempotensi: kunci sama -> transaksi sama, stok & diskon tidak berlipat
  payload := jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pb,'quantity',2,'discount_type','percent','discount_value',20)));
  select stock into st from products where id=pb;
  r := complete_checkout(sh,c,o,payload,'cash',50000,null,'idem1',null,null);
  r2 := complete_checkout(sh,c,o,payload,'cash',50000,null,'idem1',null,null);
  select stock into st2 from products where id=pb;
  perform t_ck('A12 pengiriman ulang (kunci sama) = transaksi sama, stok berkurang sekali', r->>'transactionId'=r2->>'transactionId' and st-st2=2 and (r2->>'total')::numeric=24000, (st-st2)::text);
  begin perform complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pb,'quantity',2,'discount_type','percent','discount_value',10))),'cash',50000,null,'idem1',null,null); err:=null; exception when others then err:=sqlerrm; end;
  perform t_ck('A13 kunci sama dengan diskon berbeda ditolak', err like '%IDEMPOTENCY_KEY_REUSED%', coalesce(err,'(tidak error)'));

  perform t_ck('A14 overload lama complete_checkout 9 argumen sudah dihapus', not exists(select 1 from pg_proc where proname='complete_checkout' and pronargs=9));
end $$;

-- ===================== B. Tahan Bill + recall + bayar =====================
do $$
declare
  o uuid:=current_setting('t.o1')::uuid; c uuid:=current_setting('t.c1')::uuid; sh uuid:=current_setting('t.sh')::uuid;
  pa uuid; pb uuid; held uuid; held2 uuid; r jsonb; rec jsonb; tx transactions%rowtype; n int; payload jsonb; err text;
begin
  select id into pa from products where name='A'; select id into pb from products where name='B';

  payload := jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',2,'discount_type','percent','discount_value',10)),'bill_discount_type','percent','bill_discount_value',10,'customer_name','Ani','customer_phone','','table_number','3');
  held := save_held_bill(sh,c,o,payload,'hold-k1');
  held2 := save_held_bill(sh,c,o,payload,'hold-k1');
  select count(*) into n from transactions where status='held' and customer_name='Ani';
  perform t_ck('B1 Tahan Bill dengan kunci sama = satu bill (idempoten)', held=held2 and n=1, n::text);
  select * into tx from transactions where id=held;
  perform t_ck('B2 bill ditahan menyimpan diskon: 20000 - 2000 - 10% dari 18000 = 16200', tx.subtotal=20000 and tx.item_discount=2000 and tx.bill_discount=1800 and tx.total=16200, tx.total::text);
  perform t_ck('B3 Tahan Bill tidak mengurangi stok', (select stock from products where id=pa) = (select stock from products where id=pa));

  rec := recall_held_bill_with_items(held);
  perform t_ck('B4 recall membawa diskon bill (percent 10) & diskon item (percent 10, 2000)',
    rec->>'billDiscountType'='percent' and (rec->>'billDiscountValue')::numeric=10
    and rec->'items'->0->>'discountType'='percent' and (rec->'items'->0->>'discountValue')::numeric=10 and (rec->'items'->0->>'discountAmount')::numeric=2000, rec::text);

  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',2,'discount_type','percent','discount_value',10)),'bill_discount_type','percent','bill_discount_value',10),'cash',20000,null,'b-pay1',null,held);
  select * into tx from transactions where id=held;
  perform t_ck('B5 bayar bill ditahan: total sama persis & status completed', tx.status='completed' and tx.total=16200 and (r->>'change')::numeric=3800, tx.total::text);

  -- tambah item saat recall + harga produk berubah sejak ditahan
  held := save_held_bill(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',2,'discount_type','percent','discount_value',10)),'customer_name','Budi'),'hold-k2');
  reset role; update products set selling_price=12000 where id=pa; set role authenticated;
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',3,'discount_type','percent','discount_value',10))),'cash',50000,null,'b-pay2',null,held);
  select * into tx from transactions where id=held;
  perform t_ck('B6 qty lama pakai harga tahan (2x10000) + qty baru harga katalog (1x12000), diskon 10% dari 32000 = 3200, total 28800', tx.subtotal=32000 and tx.item_discount=3200 and tx.total=28800, tx.total::text);
  perform t_ck('B7 diskon terbagi ke 2 baris tanpa selisih (2000 + 1200)', (select sum(discount_amount) from transaction_items where transaction_id=held)=3200 and (select count(*) from transaction_items where transaction_id=held)=2);
  reset role; update products set selling_price=10000 where id=pa; set role authenticated;

  begin perform save_held_bill(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1)),'bill_discount_type','percent','bill_discount_value',100)); err:=null; exception when others then err:=sqlerrm; end;
  perform t_ck('B8 Tahan Bill dengan diskon yang menihilkan total ditolak', err like '%total menjadi nol%', coalesce(err,'(tidak error)'));
end $$;

-- ===================== C. Split Bill dengan diskon =====================
do $$
declare
  o uuid:=current_setting('t.o1')::uuid; c uuid:=current_setting('t.c1')::uuid; sh uuid:=current_setting('t.sh')::uuid;
  pa uuid; pb uuid; pc uuid; held uuid; r jsonb; tx transactions%rowtype; items jsonb; s numeric; parent_total numeric; k int; rem_total numeric;
begin
  select id into pa from products where name='A'; select id into pb from products where name='B'; select id into pc from products where name='C';

  -- C1: A x4 (item nominal 4000) + C x3, diskon bill 10%
  held := save_held_bill(sh,c,o,jsonb_build_object('items',jsonb_build_array(
      jsonb_build_object('product_id',pa,'quantity',4,'discount_type','amount','discount_value',4000),
      jsonb_build_object('product_id',pc,'quantity',3)),
      'bill_discount_type','percent','bill_discount_value',10),'hold-s1');
  select * into tx from transactions where id=held; parent_total := tx.total;
  perform t_ck('C1 total awal: 49999 - 4000 - 10% dari 45999 (4600) = 41399', parent_total=41399 and tx.bill_discount=4600, parent_total::text);
  perform start_split_from_held(held);
  select * into tx from transactions where id=held;
  perform t_ck('C2 mulai split: diskon bill dipindah ke item (bill 0, item 8600), total tetap 41399', tx.bill_discount=0 and tx.item_discount=8600 and tx.total=41399 and tx.bill_discount_type is null, tx.item_discount::text);
  perform t_ck('C3 start_split dipanggil lagi (idempoten)', (select start_split_from_held(held) is not null) and (select item_discount from transactions where id=held)=8600);
  items := get_held_bill_items(held);
  perform t_ck('C4 sisa item membawa total diskon 8600', (select sum((x->>'discountAmount')::numeric) from jsonb_array_elements(items) x)=8600);

  s := 0;
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1))),'cash',99999,null,'s1-1',held,null); s := s + (r->>'total')::numeric;
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1))),'cash',99999,null,'s1-2',held,null); s := s + (r->>'total')::numeric;
  select * into tx from transactions where id=held;
  perform t_ck('C5 induk tetap ditahan selama masih ada sisa', tx.status='held');
  rem_total := (select sum((x->>'quantity')::numeric*(x->>'unitPrice')::numeric-(x->>'discountAmount')::numeric) from jsonb_array_elements(get_held_bill_items(held)) x);
  perform t_ck('C6 sisa bill + yang sudah dibayar = total awal', rem_total + s = parent_total, (rem_total+s)::text);
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',2),jsonb_build_object('product_id',pc,'quantity',3))),'cash',99999,null,'s1-3',held,null); s := s + (r->>'total')::numeric;
  select * into tx from transactions where id=held;
  perform t_ck('C7 split 1+1+(2 A & 3 C): jumlah semua bayaran = total awal PERSIS (tanpa selisih rupiah)', s = parent_total and tx.status='cancelled', s::text);

  -- C2: pembulatan tiga arah: C x3 = 9999, diskon bill nominal 100 -> 33 + 34 + 33
  held := save_held_bill(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pc,'quantity',3)),'bill_discount_type','amount','bill_discount_value',100),'hold-s2');
  perform start_split_from_held(held);
  s := 0;
  for k in 1..3 loop
    r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pc,'quantity',1))),'cash',99999,null,'s2-'||k,held,null);
    s := s + (r->>'total')::numeric;
  end loop;
  perform t_ck('C8 split tiga arah dari 9999 dengan diskon 100: total semua = 9899', s=9899, s::text);
  perform t_ck('C9 bagian diskon 33/33/34 (jumlah 100, selisih terkecil)', (select array_agg(ti.discount_amount order by ti.discount_amount) from transaction_items ti join transactions t on t.id=ti.transaction_id where t.parent_transaction_id=held) = array[33,33,34]::numeric[],
     (select array_agg(ti.discount_amount order by ti.discount_amount)::text from transaction_items ti join transactions t on t.id=ti.transaction_id where t.parent_transaction_id=held));

  -- C3: split sebagian lalu bayar sisanya biasa (bill ditahan, dengan diskon item persen)
  held := save_held_bill(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pb,'quantity',4,'discount_type','percent','discount_value',10))),'hold-s3');
  perform start_split_from_held(held);
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pb,'quantity',1))),'cash',99999,null,'s3-1',held,null);
  perform t_ck('C10 bagian split 1 dari 4 B (60000, diskon 6000): 13500', (r->>'total')::numeric=13500, r->>'total');
  items := get_held_bill_items(held);
  perform t_ck('C11 sisa: 3 porsi, diskon 4500, bertipe nominal', (items->0->>'quantity')::numeric=3 and (items->0->>'discountAmount')::numeric=4500 and items->0->>'discountType'='amount', items::text);
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pb,'quantity',3,'discount_type','amount','discount_value',4500))),'cash',99999,null,'s3-2',null,held);
  perform t_ck('C12 bayar sisa sebagai bill biasa: 40500', (r->>'total')::numeric=40500, r->>'total');
end $$;

-- ===================== D. Batal Bill =====================
do $$
declare
  o uuid:=current_setting('t.o1')::uuid; c uuid:=current_setting('t.c1')::uuid; sh uuid:=current_setting('t.sh')::uuid;
  pa uuid; r jsonb; v jsonb; tid uuid; st0 numeric; st1 numeric; st2 numeric; cash0 numeric; cash1 numeric; err text; held uuid; child uuid; tx transactions%rowtype;
begin
  select id into pa from products where name='A';
  select (get_shift_cash_summary(sh)->>'expected_cash')::numeric into cash0;
  select stock into st0 from products where id=pa;
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',3,'discount_type','percent','discount_value',10))),'cash',40000,null,'v1',null,null);
  tid := (r->>'transactionId')::uuid;
  select stock into st1 from products where id=pa;
  select (get_shift_cash_summary(sh)->>'expected_cash')::numeric into cash1;
  perform t_ck('D0 sebelum batal: kas bertambah sebesar total tunai (3x10000-10% = 27000), stok -3', cash1-cash0=27000 and st0-st1=3, (cash1-cash0)::text);

  begin perform t_void(tid,'  '); err:=null; exception when others then err:=sqlerrm; end;
  perform t_ck('D1 alasan wajib', err like '%Alasan pembatalan wajib%', coalesce(err,'(tidak error)'));

  v := t_void(tid,'Pelanggan batal pesan');
  select * into tx from transactions where id=tid;
  select stock into st2 from products where id=pa;
  perform t_ck('D2 status voided + alasan + waktu tersimpan', tx.status='voided' and tx.void_reason='Pelanggan batal pesan' and tx.voided_at is not null and (v->>'alreadyVoided')='false');
  perform t_ck('D3 stok kembali seperti sebelum bill', st2=st0, st2::text);
  perform t_ck('D4 kas yang diharapkan kembali seperti sebelum bill (uang dikembalikan)', (get_shift_cash_summary(sh)->>'expected_cash')::numeric=cash0, (get_shift_cash_summary(sh)->>'expected_cash'));
  perform t_ck('D5 pembayaran berstatus refunded', (select status::text from payments where transaction_id=tid)='refunded');
  v := t_void(tid,'ulang');
  perform t_ck('D6 batal ulang = sukses tanpa efek (aman untuk retry)', (v->>'alreadyVoided')='true' and (select stock from products where id=pa)=st0);

  -- bill ditahan & anak split tidak bisa dibatalkan lewat jalur ini
  held := save_held_bill(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',2))));
  begin perform t_void(held,'coba'); err:=null; exception when others then err:=sqlerrm; end;
  perform t_ck('D7 bill ditahan tidak bisa dibatalkan (pakai Hapus Bill)', err like '%sudah dibayar%', coalesce(err,'(tidak error)'));
  perform start_split_from_held(held);
  r := complete_checkout(sh,c,o,jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',pa,'quantity',1))),'cash',99999,null,'v-split',held,null);
  child := (r->>'transactionId')::uuid;
  begin perform t_void(child,'coba'); err:=null; exception when others then err:=sqlerrm; end;
  perform t_ck('D8 anak Split Bill tidak bisa dibatalkan satuan', err like '%Split Bill%', coalesce(err,'(tidak error)'));
  perform delete_held_bill(held);

  perform set_config('t.void_id', tid::text, false);
end $$;

-- ===================== E. Laporan =====================
do $$
declare
  c uuid:=current_setting('t.c1')::uuid; o uuid:=current_setting('t.o1')::uuid; sh uuid:=current_setting('t.sh')::uuid;
  rep jsonb; lst jsonb; v numeric; cats numeric; items jsonb; dash jsonb; sum_t numeric; sum_d numeric; sum_g numeric;
begin
  select sum(total), sum(item_discount+bill_discount), sum(subtotal) into sum_t, sum_d, sum_g from transactions where shift_id=sh and status='completed';
  rep := get_shift_report(sh);
  perform t_ck('E1 laporan: pendapatan = jumlah total bill selesai (bill batal tidak ikut)', (rep->>'totalRevenue')::numeric=sum_t, (rep->>'totalRevenue'));
  perform t_ck('E2 laporan: diskon & kotor', (rep->>'discountTotal')::numeric=sum_d and (rep->>'grossSales')::numeric=sum_g and (rep->>'grossSales')::numeric-(rep->>'discountTotal')::numeric=(rep->>'totalRevenue')::numeric, rep::text);
  perform t_ck('E3 laporan: jumlah bill batal tercatat', (rep->>'voidedCount')::int=1 and (rep->>'voidedTotal')::numeric=27000);
  select sum((x->>'total')::numeric) into cats from jsonb_array_elements(rep->'categories') x;
  perform t_ck('E4 total kategori + diskon bill = pendapatan + diskon bill (kategori memakai harga setelah diskon item)', cats = (rep->>'totalRevenue')::numeric + (rep->>'billDiscount')::numeric, cats::text);

  lst := list_shift_bills(sh,'voided','',30,0);
  perform t_ck('E5 daftar bill batal', (lst->>'voidedCount')::int=1 and jsonb_array_length(lst->'rows')=1 and lst->'rows'->0->>'voidReason'='Pelanggan batal pesan');
  lst := list_shift_bills(sh,'completed','',100,0);
  perform t_ck('E6 daftar selesai tidak memuat bill batal; ada kolom diskon', not exists(select 1 from jsonb_array_elements(lst->'rows') x where x->>'status'='voided') and (lst->'rows'->0 ? 'itemDiscount'));
  items := get_bill_items(current_setting('t.void_id')::uuid);
  perform t_ck('E7 get_bill_items menyertakan diskon baris', (items->0->>'discount')::numeric=3000 and (items->0->>'subtotal')::numeric=30000, items::text);

  dash := get_dashboard_summary(c,o, now()-interval '1 day', now()+interval '1 day', now()-interval '3 days', now()-interval '1 day');
  perform t_ck('E8 dashboard: penjualan = pendapatan shift, diskon ikut dilaporkan', (dash->>'sales')::numeric=sum_t and (dash->>'discountTotal')::numeric=sum_d, dash::text);
end $$;

-- ===================== F. Tutup shift: kas =====================
do $$
declare sh uuid:=current_setting('t.sh')::uuid; c uuid:=current_setting('t.c1')::uuid; err text; tid uuid;
begin
  -- tutup shift lalu coba batalkan bill di shift tertutup
  select id into tid from transactions where shift_id=sh and status='completed' order by created_at limit 1;
  perform close_shift(sh, 0);
  begin perform t_void(tid,'terlambat'); err:=null; exception when others then err:=sqlerrm; end;
  perform t_ck('F1 bill pada shift yang sudah ditutup tidak bisa dibatalkan', err like '%sudah ditutup%', coalesce(err,'(tidak error)'));
end $$;

reset role;
select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else '  -> '||coalesce(detail,'') end from public.t_chk;
drop table public.t_chk;
drop function public.t_ck(text,boolean,text);
