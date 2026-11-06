-- Hapus semua penjualan dan pengeluaran milik classiccoffee786@gmail.com.
-- Jalankan di SQL Editor Supabase (role postgres/admin). Satu blok DO = satu transaksi.
--
-- Default: SIMULASI. Blok selalu berakhir dengan error sengaja, sehingga semua perubahan dibatalkan
-- dan pesan error menampilkan jumlah yang AKAN dihapus. Untuk benar-benar menghapus, ubah
-- "v_commit boolean := false" menjadi "v_commit boolean := true" lalu jalankan lagi.
--
-- Yang DIHAPUS: bill (termasuk bill ditahan, item, pembayaran, refund, voucher terpakai),
--               pengeluaran (operasional dan belanja dari laci), dan baris kas untuk penjualan, refund, pengeluaran.
-- Yang TIDAK DIHAPUS: shift (modal awal dan catatan buka/tutup), kas manual, produk, bahan, stok, belanja bahan,
--               riwayat tutup hari (day_closes), dan log aktivitas.

do $$
declare
  v_commit boolean := false;
  v_biz_ids uuid[];
  v_biz uuid;
  v_out uuid[];
  v_tx uuid[];
  v_exp uuid[];
  v_item uuid[];
  v_linked int := 0;
  v_bill int; v_pengeluaran int; v_item_n int; v_kas_jual int; v_kas_keluar int; v_refund int; v_shift int;
begin
  -- 1. Bisnis milik email ini (sebagai pemilik). Harus tepat satu.
  select array_agg(distinct bm.business_id) into v_biz_ids
  from auth.users u
  join public.business_members bm on bm.auth_user_id = u.id and bm.role = 'owner'
  where lower(u.email) = lower('classiccoffee786@gmail.com');

  if coalesce(array_length(v_biz_ids, 1), 0) <> 1 then
    raise exception 'Email harus jadi pemilik tepat 1 bisnis. Ditemukan: %', coalesce(array_length(v_biz_ids, 1), 0);
  end if;
  v_biz := v_biz_ids[1];

  select coalesce(array_agg(id), '{}') into v_out from public.outlets where business_id = v_biz;
  select coalesce(array_agg(id), '{}') into v_tx from public.transactions where outlet_id = any(v_out);
  select coalesce(array_agg(id), '{}') into v_exp from public.expenses where business_id = v_biz;
  select coalesce(array_agg(id), '{}') into v_item from public.expense_items where expense_id = any(v_exp);

  -- 2. Belanja bahan yang masih aktif dan tertaut ke pengeluaran: berhenti, jangan hapus stok diam-diam.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'purchase_lines' and column_name = 'expense_item_id') then
    execute 'select count(*) from public.purchase_lines pl join public.purchases p on p.id = pl.purchase_id
             where pl.expense_item_id = any($1) and p.cancelled_at is null'
      into v_linked using v_item;
  end if;
  if v_linked > 0 then
    raise exception 'Ada % belanja bahan aktif yang tertaut ke pengeluaran ini. Batalkan belanjanya di BackOffice (Bahan & Resep > Belanja) dulu, lalu jalankan ulang.', v_linked;
  end if;

  -- Hitung dulu, untuk ditampilkan.
  select count(*) into v_bill from public.transactions where id = any(v_tx);
  select count(*) into v_refund from public.transaction_refunds where transaction_id = any(v_tx);
  select count(*) into v_pengeluaran from public.expenses where id = any(v_exp);
  select count(*) into v_item_n from public.expense_items where id = any(v_item);
  select count(*) into v_kas_jual from public.cash_ledger where source_type in ('payment', 'refund') and outlet_id = any(v_out);
  select count(*) into v_kas_keluar from public.cash_ledger where source_type = 'expense' and outlet_id = any(v_out);
  select count(*) into v_shift from public.shifts where outlet_id = any(v_out);

  -- 3. Kunci hari menolak hapus di hari yang sudah ditutup. Dimatikan hanya di dalam transaksi ini,
  --    dan dinyalakan lagi sebelum selesai.
  alter table public.cash_ledger disable trigger cash_ledger_day_lock;
  alter table public.expense_items disable trigger expense_item_day_lock;
  alter table public.expense_items disable trigger trg_expense_item_linked;

  -- 4. Penjualan: baris kas dulu, lalu refund (yang tidak ikut cascade), lalu bill
  --    (item, pembayaran, bill ditahan, voucher terpakai ikut terhapus otomatis).
  delete from public.cash_ledger where source_type in ('payment', 'refund') and outlet_id = any(v_out);
  delete from public.transaction_refunds where transaction_id = any(v_tx);
  delete from public.transactions where id = any(v_tx);

  -- 5. Pengeluaran: baris kas, barang, lalu pengeluaran.
  delete from public.cash_ledger where source_type = 'expense' and outlet_id = any(v_out);
  delete from public.expense_items where id = any(v_item);
  delete from public.expenses where id = any(v_exp);

  -- 6. Nyalakan lagi kunci.
  alter table public.cash_ledger enable trigger cash_ledger_day_lock;
  alter table public.expense_items enable trigger expense_item_day_lock;
  alter table public.expense_items enable trigger trg_expense_item_linked;

  -- 7. Hasil.
  if not v_commit then
    raise exception 'SIMULASI, BELUM ADA YANG DIHAPUS. Akan dihapus: bill %, refund %, pengeluaran %, barang pengeluaran %, baris kas penjualan %, baris kas pengeluaran %. Shift yang tetap: %. Jika sudah sesuai, ubah v_commit menjadi true.',
      v_bill, v_refund, v_pengeluaran, v_item_n, v_kas_jual, v_kas_keluar, v_shift;
  end if;
  raise notice 'SELESAI. Dihapus: bill %, refund %, pengeluaran %, barang pengeluaran %, baris kas penjualan %, baris kas pengeluaran %.',
    v_bill, v_refund, v_pengeluaran, v_item_n, v_kas_jual, v_kas_keluar;
end $$;
