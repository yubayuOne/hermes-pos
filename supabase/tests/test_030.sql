-- Tes migrasi 030 (langganan, batas paket, kunci, notifikasi) di atas rantai migrasi 001 sampai 030.
-- Setiap baris keluaran harus diawali PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
create or replace function pg_temp.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL % (tidak ada galat)', label;
exception when others then
  raise notice '%', (case when sqlerrm ilike '%' || expect || '%' then 'PASS ' else 'FAIL ' end) || label || ' -> ' || sqlerrm;
end $$;
-- Menjalankan satu pernyataan sebagai pengguna tertentu.
create or replace function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false); select null::void;
$$;

insert into auth.users(id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'rina@kafe.id'),
  ('a0000000-0000-0000-0000-000000000002', 'dedi@kafe.id');

-- ===== trial otomatis
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
set role authenticated;
select set_config('t.reg', public.register_business('Kopi Pojok', 'Outlet Utama', null)::text, false);
select set_config('t.b1', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o1', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
select pg_temp.ok('T1 bisnis baru mendapat trial', (public.get_subscription_status() ->> 'state') = 'trial');
select pg_temp.ok('T2 trial 3 hari', (public.get_subscription_status() ->> 'days_left')::int = 3);
select pg_temp.ok('T3 batas trial 1 outlet, 2 kasir, 40 produk',
  (public.get_subscription_status() -> 'limits') = '{"outlets": 1, "cashiers_per_outlet": 2, "products_per_outlet": 40}'::jsonb);
select pg_temp.ok('T4 pemakaian per outlet tersedia', jsonb_array_length(public.get_subscription_status() -> 'usage') = 1);
select pg_temp.ok('T5 langganan terbaca lewat RLS', (select count(*) from public.subscriptions) = 1);
select pg_temp.ok('T6 paket terbaca publik', (select count(*) from public.plans) = 4);

-- ===== batas trial
select pg_temp.ok('L1 kasir 1', public.owner_create_cashier(current_setting('t.o1')::uuid, 'Sari', '123456') is not null);
select pg_temp.ok('L2 kasir 2', public.owner_create_cashier(current_setting('t.o1')::uuid, 'Budi', '123456') is not null);
select pg_temp.fails('L3 kasir ke-3 ditolak saat trial', format('select public.owner_create_cashier(%L, %L, %L)', current_setting('t.o1'), 'Wulan', '123456'), 'Batas 2 kasir');
select pg_temp.fails('L4 outlet ke-2 ditolak saat trial', $q$select public.owner_create_outlet('Cabang 2')$q$, 'Batas 1 outlet');
select set_config('t.n', (select count(*)::text from generate_series(1, 40) g, lateral (select public.create_product(current_setting('t.o1')::uuid, null, 'Menu ' || g, 1000, 5000, 0)) x), false);
select pg_temp.ok('L5 40 produk boleh saat trial', current_setting('t.n') = '40');
select pg_temp.fails('L6 produk ke-41 ditolak', format('select public.create_product(%L, null, %L, 1000, 5000, 0)', current_setting('t.o1'), 'Menu 41'), 'Batas 40 produk');
select pg_temp.ok('L7 menu sementara tidak dihitung',
  (select count(*) from public.products where outlet_id = current_setting('t.o1')::uuid and is_active and not is_temporary) = 40);
reset role;
insert into public.products(outlet_id, name, selling_price, is_temporary) values (current_setting('t.o1')::uuid, 'Titipan', 7000, true);
select pg_temp.ok('L8 menu sementara boleh di atas batas', (select count(*) from public.products where is_temporary) = 1);
set role authenticated;
select set_config('t.c1', (select cashier_id::text from public.cashier_sessions where cashier_name = 'Sari'), false);
select public.owner_set_cashier_active(current_setting('t.c1')::uuid, false);
select pg_temp.ok('L9 kasir bisa dinonaktifkan', (select not is_active from public.owner_list_cashiers() where cashier_name = 'Sari'));
select pg_temp.ok('L10 kasir baru masuk setelah ada slot', public.owner_create_cashier(current_setting('t.o1')::uuid, 'Wulan', '123456') is not null);
select pg_temp.fails('L11 mengaktifkan kembali dihitung batas', format('select public.owner_set_cashier_active(%L, true)', current_setting('t.c1')), 'Batas 2 kasir');
select set_config('t.p1', (select id::text from public.products where name = 'Menu 1'), false);
select public.delete_product(current_setting('t.p1')::uuid, current_setting('t.o1')::uuid);
select pg_temp.ok('L12 produk baru masuk setelah satu dimatikan', public.create_product(current_setting('t.o1')::uuid, null, 'Menu 41', 1000, 5000, 0) is not null);
reset role;
select pg_temp.fails('L13 produk lama tidak bisa diaktifkan di atas batas', format('update public.products set is_active = true where id = %L', current_setting('t.p1')), 'Batas 40 produk');

-- ===== aktivasi berbayar
select set_config('t.trial_end', (select expires_at::text from public.subscriptions where business_id = current_setting('t.b1')::uuid), false);
select public.admin_activate_subscription(current_setting('t.b1')::uuid, 'monthly', 1);
select pg_temp.ok('A1 aktivasi saat trial menambah sisa waktu',
  (select expires_at = current_setting('t.trial_end')::timestamptz + interval '1 month' from public.subscriptions where business_id = current_setting('t.b1')::uuid));
select pg_temp.fails('A2 trial tidak bisa diaktifkan admin', format('select public.admin_activate_subscription(%L, %L, 0)', current_setting('t.b1'), 'trial'), 'Paket tidak valid');
select pg_temp.fails('A3 owner tidak bisa memanggil aktivasi', $q$set role authenticated; select public.admin_activate_subscription(public.my_business_id(), 'annual', 5)$q$, 'permission denied');
reset role;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
set role authenticated;
select pg_temp.ok('A4 status aktif dengan batas berbayar',
  (public.get_subscription_status() ->> 'state') = 'active'
  and (public.get_subscription_status() -> 'limits') = '{"outlets": 2, "cashiers_per_outlet": 3, "products_per_outlet": 100}'::jsonb);
select public.owner_set_cashier_active(current_setting('t.c1')::uuid, true);
select pg_temp.ok('A5 kasir ke-3 boleh di paket berbayar', (select count(*) from public.cashier_sessions where is_active) = 3);
select pg_temp.fails('A6 kasir ke-4 ditolak', format('select public.owner_create_cashier(%L, %L, %L)', current_setting('t.o1'), 'Dedi', '123456'), 'Batas 3 kasir');
select set_config('t.o2', public.owner_create_outlet('Cabang 2')::text, false);
select pg_temp.ok('A7 outlet tambahan masuk', current_setting('t.o2') <> '');
select pg_temp.fails('A8 outlet ke-3 ditolak', $q$select public.owner_create_outlet('Cabang 3')$q$, 'Batas 2 outlet');
select pg_temp.ok('A9 kasir dihitung per outlet', public.owner_create_cashier(current_setting('t.o2')::uuid, 'Dedi', '123456') is not null);
select pg_temp.fails('A10 pindah kasir ke outlet penuh ditolak',
  format('select public.owner_update_cashier((select cashier_id from public.cashier_sessions where cashier_name = %L), %L, %L)', 'Dedi', 'Dedi', current_setting('t.o1')), 'Batas 3 kasir');

-- ===== alur kasir tetap jalan saat aktif
select set_config('t.cw', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Wulan'), false);
select set_config('t.kopi', public.create_product(current_setting('t.o1')::uuid, null, 'Kopi', 8000, 20000, 10)::text, false);
select public.delete_product((select id from public.products where name = 'Menu 2'), current_setting('t.o1')::uuid);
select set_config('t.sh', public.open_shift(current_setting('t.cw')::uuid, current_setting('t.o1')::uuid, 50000)::text, false);
select pg_temp.ok('K1 buka shift saat aktif', current_setting('t.sh') <> '');
select pg_temp.ok('K2 checkout tunai saat aktif',
  (public.complete_checkout(current_setting('t.sh')::uuid, current_setting('t.cw')::uuid, current_setting('t.o1')::uuid,
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', current_setting('t.kopi'), 'quantity', 2))),
    'cash', 50000, null, 'k-030-1') ->> 'total')::numeric = 40000);
select pg_temp.ok('K3 stok berkurang', (select stock from public.products where id = current_setting('t.kopi')::uuid) = 8);

-- ===== pengingat
reset role;
update public.subscriptions set expires_at = now() + interval '20 days 2 hours' where business_id = current_setting('t.b1')::uuid;
set role authenticated;
select public.get_subscription_status();
-- Since 069 the reminder is daily (one per day, yesterday's removed) instead of at thresholds.
select pg_temp.ok('N1 satu pengingat hari ini untuk 20 hari lagi',
  jsonb_array_length(public.list_notifications()) = 1 and (public.list_notifications() -> 0 -> 'params' ->> 'days_left')::int between 20 and 21);
select public.get_subscription_status();
select pg_temp.ok('N2 tidak dobel saat dipanggil lagi', jsonb_array_length(public.list_notifications()) = 1);
select pg_temp.ok('N3 jumlah belum dibaca', (public.get_subscription_status() ->> 'unread')::int = 1);
select pg_temp.ok('N4 tandai dibaca', public.mark_notifications_read(null) = 1 and (public.get_subscription_status() ->> 'unread')::int = 0);
select pg_temp.fails('N5 tabel notifikasi tidak terbaca langsung', 'select count(*) from public.notifications', 'permission denied');
reset role;
update public.subscriptions set expires_at = now() + interval '6 days' where business_id = current_setting('t.b1')::uuid;
set role authenticated;
select public.get_subscription_status();
select pg_temp.ok('N6 pengingat baru 6 hari, yang lama diganti', jsonb_array_length(public.list_notifications()) = 1
  and (public.list_notifications() -> 0 ->> 'kind') = 'subscription_expiring' and (public.list_notifications() -> 0 -> 'params' ->> 'days_left')::int between 6 and 7);
select pg_temp.ok('N7 tandai sebagian dengan id', public.mark_notifications_read(array[(public.list_notifications() -> 0 ->> 'id')::uuid]) = 1);

-- ===== berakhir
reset role;
-- Shift dibuka saat masih aktif, lalu langganan berakhir.
insert into public.shifts(id, cashier_id, outlet_id, opening_cash, shift_number, business_date) values
  ('b0000000-0000-0000-0000-000000000001', current_setting('t.c1')::uuid, current_setting('t.o1')::uuid, 100000, 1, current_date);
update public.shifts set opened_at = now() - interval '2 hours' where id = 'b0000000-0000-0000-0000-000000000001';
update public.subscriptions set expires_at = now() - interval '1 hour' where business_id = current_setting('t.b1')::uuid;
select set_config('t.c2', (select cashier_id::text from public.cashier_sessions where cashier_name = 'Budi'), false);
set role authenticated;
select pg_temp.ok('E1 status berakhir, sisa 0 hari', (public.get_subscription_status() ->> 'state') = 'expired' and (public.get_subscription_status() ->> 'days_left')::int = 0);
select pg_temp.ok('E2 notifikasi berakhir dibuat', (public.list_notifications() -> 0 ->> 'kind') = 'subscription_expired');
select pg_temp.fails('E3 shift baru ditolak', format('select public.open_shift(%L, %L, 0)', current_setting('t.c2'), current_setting('t.o1')), 'Langganan berakhir');
select pg_temp.fails('E4 kasir baru ditolak', format('select public.owner_create_cashier(%L, %L, %L)', current_setting('t.o2'), 'Rini', '123456'), 'Langganan berakhir');
select pg_temp.fails('E5 produk baru ditolak', format('select public.create_product(%L, null, %L, 1000, 5000, 0)', current_setting('t.o2'), 'Teh'), 'Langganan berakhir');
select pg_temp.fails('E6 kategori baru ditolak', format('select public.create_category(%L, %L, 0)', current_setting('t.o2'), 'Minuman'), 'Langganan berakhir');
select pg_temp.fails('E7 outlet baru ditolak', $q$select public.owner_create_outlet('Cabang 9')$q$, 'Langganan berakhir');
select pg_temp.ok('E8 data tetap terbaca', (select count(*) from public.products where outlet_id = current_setting('t.o1')::uuid) > 40);
select public.owner_set_cashier_active(current_setting('t.c1')::uuid, false);
select pg_temp.ok('E9 menonaktifkan tetap boleh', (select not is_active from public.owner_list_cashiers() where cashier_id = current_setting('t.c1')::uuid));
select pg_temp.fails('E10 mengaktifkan kembali ditolak', format('select public.owner_set_cashier_active(%L, true)', current_setting('t.c1')), 'Langganan berakhir');
reset role;
-- Penjualan di shift yang dibuka sebelum berakhir masih masuk dalam 24 jam (antrean offline).
insert into public.transactions(shift_id, cashier_id, outlet_id, number, status)
values ('b0000000-0000-0000-0000-000000000001', current_setting('t.c1')::uuid, current_setting('t.o1')::uuid, 'T-030-1', 'completed');
select pg_temp.ok('E11 penjualan dari shift sebelum berakhir lolos dalam 24 jam', exists (select 1 from public.transactions where number = 'T-030-1'));
update public.subscriptions set expires_at = now() - interval '25 hours' where business_id = current_setting('t.b1')::uuid;
select pg_temp.fails('E12 lewat 24 jam ditolak', format($q$insert into public.transactions(shift_id, cashier_id, outlet_id, number, status) values (%L, %L, %L, 'T-030-2', 'completed')$q$,
  'b0000000-0000-0000-0000-000000000001', current_setting('t.c1'), current_setting('t.o1')), 'Langganan berakhir');
-- Shift yang dibuka setelah tanggal berakhir tidak memberi kelonggaran.
update public.subscriptions set expires_at = now() + interval '1 day' where business_id = current_setting('t.b1')::uuid;
insert into public.shifts(id, cashier_id, outlet_id, opening_cash, shift_number, business_date, status) values
  ('b0000000-0000-0000-0000-000000000002', current_setting('t.c1')::uuid, current_setting('t.o2')::uuid, 0, 2, current_date, 'closed');
update public.subscriptions set expires_at = now() - interval '1 minute' where business_id = current_setting('t.b1')::uuid;
update public.shifts set opened_at = now() where id = 'b0000000-0000-0000-0000-000000000002';
select pg_temp.fails('E13 bill ditahan baru ditolak', format($q$insert into public.transactions(shift_id, cashier_id, outlet_id, number, status) values (%L, %L, %L, 'T-030-3', 'held')$q$,
  'b0000000-0000-0000-0000-000000000002', current_setting('t.c1'), current_setting('t.o2')), 'Langganan berakhir');
update public.transactions set status = 'voided' where number = 'T-030-1';
select pg_temp.ok('E14 void tetap boleh', (select status = 'voided' from public.transactions where number = 'T-030-1'));

-- ===== perpanjangan setelah berakhir
select public.admin_activate_subscription(current_setting('t.b1')::uuid, 'annual', 1);
select pg_temp.ok('R1 perpanjangan setelah berakhir dihitung dari sekarang',
  (select expires_at between now() + interval '12 months' - interval '1 minute' and now() + interval '12 months' + interval '1 minute' from public.subscriptions where business_id = current_setting('t.b1')::uuid));
set role authenticated;
select pg_temp.ok('R2 kategori bisa dibuat lagi', public.create_category(current_setting('t.o2')::uuid, 'Minuman', 0) is not null);

-- ===== isolasi bisnis
reset role;
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.fails('I1 akun tanpa bisnis tidak punya status', 'select public.get_subscription_status()', 'Hanya owner');
select public.register_business('Warung Dedi', 'Dedi 1', null);
select pg_temp.ok('I2 bisnis kedua mendapat trial sendiri', (public.get_subscription_status() ->> 'state') = 'trial');
-- A new trial gets its own daily reminder (069); nothing from the first business shows up.
select pg_temp.ok('I3 notifikasi bisnis lain tidak terlihat', jsonb_array_length(public.list_notifications()) = 1
  and public.list_notifications() -> 0 ->> 'kind' = 'trial_expiring');
select pg_temp.ok('I4 hanya langganan sendiri yang terbaca', (select count(*) from public.subscriptions) = 1);
select pg_temp.ok('I5 tidak bisa menandai notifikasi bisnis lain', public.mark_notifications_read(null) = 1);
reset role;
