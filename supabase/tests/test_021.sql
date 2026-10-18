-- Uji pembersihan menu sementara (migrasi 021). Butuh migrasi 001-021 pada Postgres uji dengan stub auth.
-- MENGOSONGKAN data uji. Setiap baris keluaran harus diawali PASS.
\set ON_ERROR_STOP on
\pset tuples_only on
reset role;
truncate transactions, transaction_items, payments, shifts, held_bills, cash_ledger, products, categories, cashier_sessions, outlets cascade;
delete from auth.users;
select gen_random_uuid() as u1 \gset
select gen_random_uuid() as c1 \gset
select gen_random_uuid() as o1 \gset
select gen_random_uuid() as o2 \gset
insert into auth.users values(:'u1');
insert into outlets(id,name) values(:'o1','A'),(:'o2','B');
insert into cashier_sessions(auth_user_id,cashier_id,outlet_id,cashier_name,outlet_name,terminal_name,is_active) values(:'u1',:'c1',:'o1','K','A','T',true);
insert into products(outlet_id,name,hpp,selling_price,stock,station) values(:'o1','Produk Katalog',1,10000,50,'kitchen');
-- menu sementara: lama & tak terpakai (hapus) | lama & dipakai (simpan) | baru (simpan) | outlet lain, lama & tak terpakai (simpan saat bersih-bersih outlet A)
insert into products(id,outlet_id,name,hpp,selling_price,stock,station,is_temporary,created_at) values
 (gen_random_uuid(),:'o1','Lama Tak Terpakai',0,5000,999999,'bar',true, now()-interval '5 days'),
 (gen_random_uuid(),:'o1','Lama Dipakai',0,6000,999999,'bar',true, now()-interval '5 days'),
 (gen_random_uuid(),:'o1','Baru',0,7000,999999,'bar',true, now()-interval '1 hour'),
 (gen_random_uuid(),:'o2','Outlet Lain Lama',0,8000,999999,'bar',true, now()-interval '5 days');

set role authenticated; select set_config('request.jwt.claim.sub',:'u1',false);
select open_shift(:'c1',:'o1',0) as sh \gset
-- pakai "Lama Dipakai" di bill ditahan -> baris transaction_items mereferensikannya
select save_held_bill(:'sh',:'c1',:'o1',jsonb_build_object('items',jsonb_build_array(
  jsonb_build_object('product_id',(select id from products where name='Lama Dipakai'),'quantity',1)),
  'customer_name','X','customer_phone','','table_number','1')) is not null;

create temp table chk(name text, ok boolean, detail text);
grant all on chk to authenticated;
-- membuat menu sementara baru memicu pembersihan outlet sendiri
select create_temporary_product(:'c1',:'o1','Menu Baru Dibuat',9000,'kitchen') is not null;
insert into chk select 'oportunistik: lama tak terpakai terhapus', not exists(select 1 from products where name='Lama Tak Terpakai'), '';
insert into chk select 'lama tapi dipakai di bill tetap ada', exists(select 1 from products where name='Lama Dipakai'), '';
insert into chk select 'menu baru (<2 hari) tetap ada', exists(select 1 from products where name='Baru'), '';
insert into chk select 'menu yang baru dibuat ada', exists(select 1 from products where name='Menu Baru Dibuat'), '';
insert into chk select 'produk katalog (bukan sementara) aman', exists(select 1 from products where name='Produk Katalog'), '';
-- bill ditahan masih bisa dipanggil/dibaca (produk referensi utuh)
insert into chk select 'item bill ditahan masih terbaca', jsonb_array_length(get_held_bill_items((select id from transactions where status='held' limit 1)))=1, '';

-- klien tidak boleh memanggil fungsi pembersihan langsung
do $$ declare ok boolean; begin
  begin perform public.cleanup_temporary_products(null); ok:=false; exception when others then ok:=true; end;
  insert into chk values('klien (authenticated) tidak bisa memanggil cleanup', ok, '');
end $$;
reset role;
-- dicek sebagai superuser (RLS menyembunyikan outlet lain dari role authenticated)
insert into chk select 'outlet lain tidak tersentuh oleh pembersihan outlet A', exists(select 1 from products where name='Outlet Lain Lama'), '';
-- pembersihan global (jalur pg_cron) menghapus outlet lain yang lama & tak terpakai
select public.cleanup_temporary_products(null) as removed \gset
insert into chk select 'global: outlet lain lama terhapus', not exists(select 1 from products where name='Outlet Lain Lama') and :removed = 1, 'removed='||:'removed';
insert into chk select 'global: yang dipakai tetap ada', exists(select 1 from products where name='Lama Dipakai'), '';
select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else '  -> '||coalesce(detail,'') end from chk;
