-- Uji RPC migrasi 020 (Dashboard, laporan shift, daftar bill). Butuh Postgres dengan stub auth + migrasi 001-020 sudah diterapkan
-- (lihat setup_db.py). Jalankan: psql "$URI" -f supabase/tests/test_020.sql  -> semua baris harus diawali PASS.
-- NB: skrip ini MENGOSONGKAN data transaksi/produk; hanya untuk database uji lokal.
\set ON_ERROR_STOP on
\pset tuples_only on
reset role;
truncate transactions, transaction_items, payments, shifts, held_bills, cash_ledger, products, categories, cashier_sessions, outlets cascade;
delete from auth.users;
select gen_random_uuid() as u1 \gset
select gen_random_uuid() as u2 \gset
select gen_random_uuid() as c1 \gset
select gen_random_uuid() as c2 \gset
select gen_random_uuid() as o1 \gset
insert into auth.users values(:'u1'),(:'u2');
insert into outlets(id,name) values(:'o1','Outlet A');
insert into cashier_sessions(auth_user_id,cashier_id,outlet_id,cashier_name,outlet_name,terminal_name,is_active) values
 (:'u1',:'c1',:'o1','Kasir1','Outlet A','T1',true),(:'u2',:'c2',:'o1','Kasir2','Outlet A','T2',true);
insert into categories(id,outlet_id,name) values(gen_random_uuid(),:'o1','Makanan'),(gen_random_uuid(),:'o1','Minuman');
insert into products(outlet_id,category_id,name,hpp,selling_price,stock,station)
 select :'o1',(select id from categories where name=c),n,pr/2,pr,9999,st::product_station
 from (values ('Nasi Goreng','Makanan','kitchen',25000),('Mie Ayam','Makanan','kitchen',20000),('Ayam Bakar','Makanan','kitchen',30000),
              ('Kopi Susu','Minuman','bar',18000),('Teh Tarik','Minuman','bar',15000),('Es Jeruk','Minuman','bar',12000)) v(n,c,st,pr);
-- produk tanpa kategori + dua "menu sementara" bernama sama (harus digabung)
insert into products(outlet_id,name,hpp,selling_price,stock,station,is_temporary) values
 (:'o1','Es Teh Spesial',0,10000,999999,'bar',true),(:'o1','es teh spesial ',0,10000,999999,'bar',true);

set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
select open_shift(:'c1',:'o1',100000) as sh \gset
select set_config('t.sh',:'sh',false), set_config('t.c1',:'c1',false), set_config('t.o1',:'o1',false), set_config('t.u1',:'u1',false), set_config('t.u2',:'u2',false);

-- 40 transaksi: tiap transaksi 1-3 produk, cash/qris bergantian
do $$
declare sh uuid:=current_setting('t.sh')::uuid; c uuid:=current_setting('t.c1')::uuid; o uuid:=current_setting('t.o1')::uuid; i int; items jsonb; ps uuid[]; r jsonb; tot numeric;
begin
  select array_agg(id order by name) into ps from products where outlet_id=o;
  for i in 1..40 loop
    items := jsonb_build_array(
      jsonb_build_object('product_id',ps[1+(i%array_length(ps,1))],'quantity',1+(i%3)),
      jsonb_build_object('product_id',ps[1+((i*3)%array_length(ps,1))],'quantity',1+(i%2)));
    -- hindari produk duplikat dalam payload
    if ps[1+(i%array_length(ps,1))]=ps[1+((i*3)%array_length(ps,1))] then items:=jsonb_build_array(items->0); end if;
    select sum(p.selling_price*(x->>'quantity')::numeric) into tot from jsonb_array_elements(items) x join products p on p.id=(x->>'product_id')::uuid;
    r := complete_checkout(sh,c,o,jsonb_build_object('items',items,'customer_name','Pelanggan '||i,'customer_phone','','table_number',(i%9)::text),
        (case when i%2=0 then 'cash' else 'qris' end)::payment_method, tot, null, 'k'||i, null, null);
  end loop;
end $$;

-- bill ditahan + split sebagian (2 nasi goreng dibayar dari 4)
select save_held_bill(:'sh',:'c1',:'o1',jsonb_build_object('items',jsonb_build_array(
  jsonb_build_object('product_id',(select id from products where name='Nasi Goreng'),'quantity',4),
  jsonb_build_object('product_id',(select id from products where name='Kopi Susu'),'quantity',2)),
  'customer_name','Budi','customer_phone','0812','table_number','7')) as held \gset
select set_config('t.held',:'held',false);
select start_split_from_held(:'held') is not null;
select complete_checkout(:'sh',:'c1',:'o1',jsonb_build_object('items',jsonb_build_array(
  jsonb_build_object('product_id',(select id from products where name='Nasi Goreng'),'quantity',2)),
  'customer_name','Budi','customer_phone','0812','table_number','7'),'cash'::payment_method,50000,null,'child1',:'held',null) is not null;
-- tambah satu bill ditahan lain tanpa split
select save_held_bill(:'sh',:'c1',:'o1',jsonb_build_object('items',jsonb_build_array(
  jsonb_build_object('product_id',(select id from products where name='Teh Tarik'),'quantity',3)),
  'customer_name','Sari','customer_phone','','table_number','2')) as held2 \gset

-- ===== bandingkan dengan perhitungan independen (tanpa RPC) =====
reset role;
create temp table chk(name text, ok boolean, detail text);
grant all on chk to authenticated, anon;
-- jendela: hari ini WIB lalu besok; pembanding: kemarin
select (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta') as d0 \gset
set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
select get_dashboard_summary(:'c1',:'o1',(:'d0'::timestamptz),(:'d0'::timestamptz + interval '1 day'),(:'d0'::timestamptz - interval '1 day'),(:'d0'::timestamptz)) as dash \gset
select get_shift_report(:'sh') as rep \gset
select list_shift_bills(:'sh','completed','',100,0) as lc \gset
select list_shift_bills(:'sh','held','',100,0) as lh \gset
reset role;

insert into chk select 'dashboard.sales', (:'dash'::jsonb->>'sales')::numeric = (select sum(total) from transactions where shift_id=:'sh' and status='completed'), :'dash'::jsonb->>'sales';
insert into chk select 'dashboard.count', (:'dash'::jsonb->>'count')::int = (select count(*) from transactions where shift_id=:'sh' and status='completed'), :'dash'::jsonb->>'count';
insert into chk select 'dashboard.cash+qris=sales', (:'dash'::jsonb->>'cash')::numeric + (:'dash'::jsonb->>'qris')::numeric = (:'dash'::jsonb->>'sales')::numeric, '';
insert into chk select 'dashboard.totalItems', (:'dash'::jsonb->>'totalItems')::numeric = (select sum(ti.quantity) from transaction_items ti join transactions t on t.id=ti.transaction_id where t.shift_id=:'sh' and t.status='completed'), :'dash'::jsonb->>'totalItems';
insert into chk select 'dashboard.previousSales=0', (:'dash'::jsonb->>'previousSales')::numeric = 0, :'dash'::jsonb->>'previousSales';
insert into chk select 'dashboard.hourly jumlah=sales', (select sum((h->>'total')::numeric) from jsonb_array_elements(:'dash'::jsonb->'hourly') h) = (:'dash'::jsonb->>'sales')::numeric, '';
-- menu sementara bernama sama digabung jadi satu baris
insert into chk select 'dashboard.menu sementara digabung', (select count(*) from jsonb_array_elements(:'dash'::jsonb->'top') x where lower(btrim(x->>'name'))='es teh spesial') <= 1, '';
insert into chk select 'dashboard.top terurut qty desc', (select bool_and((a->>'qty')::numeric >= (b->>'qty')::numeric) from (select x a, lead(x) over () b from jsonb_array_elements(:'dash'::jsonb->'top') x) z where b is not null), '';
insert into chk select 'dashboard.menuCount', (:'dash'::jsonb->>'menuCount')::int = (select count(distinct (lower(btrim(p.name)),p.station)) from transaction_items ti join transactions t on t.id=ti.transaction_id join products p on p.id=ti.product_id where t.shift_id=:'sh' and t.status='completed'), :'dash'::jsonb->>'menuCount';

insert into chk select 'report.totalRevenue', (:'rep'::jsonb->>'totalRevenue')::numeric = (select sum(total) from transactions where shift_id=:'sh' and status='completed'), '';
insert into chk select 'report.cash/qris', (:'rep'::jsonb->>'cashRevenue')::numeric = (select sum(total) from transactions where shift_id=:'sh' and status='completed' and payment_method='cash') and (:'rep'::jsonb->>'qrisRevenue')::numeric = (select sum(total) from transactions where shift_id=:'sh' and status='completed' and payment_method='qris'), '';
insert into chk select 'report.kategori jumlah=revenue', (select sum((c->>'total')::numeric) from jsonb_array_elements(:'rep'::jsonb->'categories') c) = (:'rep'::jsonb->>'totalRevenue')::numeric, '';
insert into chk select 'report.produk di kategori = total kategori', (select bool_and((c->>'total')::numeric = (select sum((p->>'total')::numeric) from jsonb_array_elements(c->'products') p)) from jsonb_array_elements(:'rep'::jsonb->'categories') c), '';
insert into chk select 'report.ada Tanpa Kategori', exists(select 1 from jsonb_array_elements(:'rep'::jsonb->'categories') c where c->>'categoryId'='uncategorized' and c->>'name'='Tanpa Kategori'), '';
insert into chk select 'report.expectedCash = ledger', (:'rep'::jsonb->>'expectedCash')::numeric = (select coalesce(sum(case when direction='in' then amount else -amount end),0) from cash_ledger where shift_id=:'sh'), :'rep'::jsonb->>'expectedCash';
insert into chk select 'report.totalItems', (:'rep'::jsonb->>'totalItems')::numeric = (:'dash'::jsonb->>'totalItems')::numeric, '';

insert into chk select 'list.completedCount', (:'lc'::jsonb->>'completedCount')::int = (select count(*) from transactions where shift_id=:'sh' and status='completed'), :'lc'::jsonb->>'completedCount';
insert into chk select 'list.heldCount', (:'lh'::jsonb->>'heldCount')::int = 2, :'lh'::jsonb->>'heldCount';
insert into chk select 'list.rows completed = 100 cap/semua', jsonb_array_length(:'lc'::jsonb->'rows') = (select count(*) from transactions where shift_id=:'sh' and status='completed'), jsonb_array_length(:'lc'::jsonb->'rows')::text;
insert into chk select 'list.held Budi sisa 2 nasi goreng + 2 kopi', (select (r->>'itemCount')::numeric = 4 and (r->>'total')::numeric = 2*25000+2*18000 from jsonb_array_elements(:'lh'::jsonb->'rows') r where r->>'customerName'='Budi'), (select r::text from jsonb_array_elements(:'lh'::jsonb->'rows') r where r->>'customerName'='Budi');
insert into chk select 'list.held Sari 3 teh tarik', (select (r->>'itemCount')::numeric = 3 and (r->>'total')::numeric = 45000 from jsonb_array_elements(:'lh'::jsonb->'rows') r where r->>'customerName'='Sari'), '';
insert into chk select 'list.completed itemCount > 0', (select bool_and((r->>'itemCount')::numeric > 0) from jsonb_array_elements(:'lc'::jsonb->'rows') r), '';

-- paginasi + pencarian
set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
select list_shift_bills(:'sh','completed','',10,0) as p1 \gset
select list_shift_bills(:'sh','completed','',10,10) as p2 \gset
select list_shift_bills(:'sh','completed','pelanggan 7',50,0) as ps \gset
select get_bill_items(:'held') as bi_held \gset
select get_bill_items((select id from transactions where shift_id=:'sh' and status='completed' limit 1)) as bi_done \gset
reset role;
insert into chk select 'paginasi 10+10 tanpa tumpang tindih', jsonb_array_length(:'p1'::jsonb->'rows')=10 and jsonb_array_length(:'p2'::jsonb->'rows')=10 and not exists(select 1 from jsonb_array_elements(:'p1'::jsonb->'rows') a, jsonb_array_elements(:'p2'::jsonb->'rows') b where a->>'id'=b->>'id'), '';
insert into chk select 'pencarian nama', jsonb_array_length(:'ps'::jsonb->'rows')=1 and :'ps'::jsonb->'rows'->0->>'customerName'='Pelanggan 7', :'ps'::jsonb::text;
insert into chk select 'get_bill_items held = sisa', (select sum((x->>'quantity')::numeric) from jsonb_array_elements(:'bi_held'::jsonb) x)=4, :'bi_held';
insert into chk select 'get_bill_items selesai', jsonb_array_length(:'bi_done'::jsonb)>=1, '';

-- otorisasi
do $$ declare ok boolean; begin
  set role authenticated; perform set_config('request.jwt.claim.sub',current_setting('t.u2'),false);
  begin perform get_shift_report(current_setting('t.sh')::uuid); ok:=false; exception when others then ok:=true; end;
  insert into chk values('otorisasi: laporan shift kasir lain ditolak', ok, '');
  begin perform list_shift_bills(current_setting('t.sh')::uuid,'held','',10,0); ok:=false; exception when others then ok:=true; end;
  insert into chk values('otorisasi: daftar bill kasir lain ditolak', ok, '');
  begin perform get_bill_items(current_setting('t.held')::uuid); ok:=false; exception when others then ok:=true; end;
  insert into chk values('otorisasi: item bill kasir lain ditolak', ok, '');
  begin perform get_dashboard_summary(current_setting('t.c1')::uuid,current_setting('t.o1')::uuid,now()-interval '1 day',now(),now()-interval '2 day',now()-interval '1 day'); ok:=false; exception when others then ok:=true; end;
  insert into chk values('otorisasi: dashboard kasir lain ditolak', ok, '');
  perform set_config('request.jwt.claim.sub','',false);
  begin perform get_shift_report(current_setting('t.sh')::uuid); ok:=false; exception when others then ok:=true; end;
  insert into chk values('otorisasi: tanpa login ditolak', ok, '');
  reset role; set role anon;
  begin perform get_shift_report(current_setting('t.sh')::uuid); ok:=false; exception when others then ok:=true; end;
  reset role;
  insert into chk values('otorisasi: anon ditolak', ok, '');
  set role authenticated; perform set_config('request.jwt.claim.sub',current_setting('t.u1'),false);
  begin perform get_dashboard_summary(current_setting('t.c1')::uuid,current_setting('t.o1')::uuid,now(),now()-interval '1 day',now(),now()+interval '1 day'); ok:=false; exception when others then ok:=true; end;
  insert into chk values('validasi: rentang terbalik ditolak', ok, '');
  begin perform get_dashboard_summary(current_setting('t.c1')::uuid,current_setting('t.o1')::uuid,now()-interval '900 days',now(),now()-interval '1000 days',now()-interval '900 days'); ok:=false; exception when others then ok:=true; end;
  insert into chk values('validasi: rentang >400 hari ditolak', ok, '');
  reset role;
end $$;

select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else '  -> '||coalesce(left(detail,200),'') end from chk;
select 'payload dashboard (byte): '||length(:'dash') || ' | laporan shift: '||length(:'rep') || ' | daftar 40 bill: '||length(:'lc');
