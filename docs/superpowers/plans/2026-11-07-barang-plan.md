# Barang: rencana implementasi (hermes-pos)

Tanggal: 2026-11-07. Sumber: `docs/superpowers/specs/2026-11-07-barang-design.md`. Migrasi berikutnya: **099**. Konvensi repo: commit langsung di `main`, tanpa cabang atau PR; tidak push kecuali diminta.

## Kondisi sekarang (dari kode, diperiksa hari ini)

- Tabel `ingredients` (084, ditambah 088): `price` (harga per kemasan), `pack_qty`, `pack_unit`, `stock`, `stock_started`, `pack_label`.
- Belanja: `purchases`, `purchase_lines`, `ingredient_moves` (088), `owner_save_purchase`, `owner_cancel_purchase`.
- Tautan pengeluaran ke stok: `purchase_lines.expense_item_id`, `owner_link_expense_items`, trigger `trg_expense_item_linked` (089).
- Pengeluaran kasir **sudah aktif lagi** lewat migrasi 087 (`record_expense` diberi grant ke `authenticated`). Rencana `graceful-riding-hopper` tidak dijalankan.
- BackOffice: `routes/_app/ingredients.tsx` (tab Bahan, Belanja, Resep), `components/IngredientDialog.tsx`, `PurchaseDialog.tsx`, `CountDialog.tsx`, `RecipeEditor.tsx`, `server/ingredients.ts`, `server/expenses.ts`, `lib/units.ts`.
- App kasir: `screens/shift/ExpenseSheet.tsx`, `utils/expense.ts`, `services/transaction/repository.ts` (`recordExpense`), `offlineQueue.ts` (kind `expense`), `services/local/shiftData.ts`.

**Belum diperiksa, dicek di Tahap 1:** isi kolom `kind` pada `ingredient_moves`; pemeriksaan P5/P7 yang memakai stok bahan; apakah `owner_count_ingredients` dan `recompute_hpp_for` dipakai di luar BackOffice.

## Prinsip urutan

1. SQL dulu, dengan tes. Fungsi lama tetap ada sampai APK kasir lama tidak lagi dipakai.
2. BackOffice kedua. Data lama dibaca apa adanya.
3. App kasir terakhir, karena rilisnya lewat APK dan OTA. APK lama harus tetap bisa mengirim `record_expense` dengan format lama.

## Tahap 1: SQL (migrasi 099 dan tes)

**Tujuan:** barang, kategori, dan masuk stok lewat pengeluaran tersedia di database. Belanja lama tetap bisa dibaca.

1. `099_barang.sql`:
   - `ingredients` tambah kolom `dihitung_stok boolean not null default true`, `kategori` (teks, opsional). Data lama: semua `dihitung_stok = true`.
   - Tabel `expense_categories` (`business_id`, `nama`, `aktif`, unik per bisnis pada nama tanpa huruf besar). Diisi kosong; owner mengisi.
   - `expense_items`: tambah `ingredient_id` (nullable, FK ke `ingredients`, `on delete restrict`) dan `stock_qty numeric(16,3)` (nullable, dalam satuan barang). Constraint: `stock_qty` wajib bila `ingredient_id` terisi dan barangnya `dihitung_stok`; `stock_qty > 0`.
   - Fungsi `owner_save_barang(p_outlet_id, p_id, p_name, p_unit, p_stock_counted, p_category)`. Satuan dan `dihitung_stok` terkunci bila sudah ada `ingredient_moves` atau `stock_started`.
   - Fungsi `owner_save_expense_category(p_business_id, p_id, p_name, p_active)`.
   - Fungsi `owner_stock_in_expense(p_expense_item_id, ...)` atau pemicu pada `expense_items`: membuat pergerakan `ingredient_moves` dengan `kind = 'expense'` dan menghitung ulang rata-rata dengan rumus dari spec (total bayar, bukan harga per satuan). Kunci: barang (per id), lalu baris pengeluaran.
   - Pembatalan pengeluaran yang sudah masuk stok: membalik pergerakan dan rata-rata, ditolak bila ada pergerakan sesudahnya (pesan dari spec).
   - `record_expense`: terima `ingredient_id`, `stock_qty`, dan `category` opsional. Payload lama (tanpa field baru) tetap diterima dan berperilaku seperti sekarang.
   - Pemanggilan `recompute_hpp_for` setelah setiap perubahan rata-rata.
   - Belanja (`owner_save_purchase`, `owner_link_expense_items`): dicabut dari grant `authenticated`. Fungsi tidak dihapus; data tetap bisa dibaca lewat `owner_list_purchases`.
2. Tes `supabase/tests/test_099.sql`:
   - rata-rata: stok lama positif, stok lama ≤ 0, jumlah masuk berbeda dari kemasan (contoh minyak 1 L, ditimbang 1.050 ml).
   - satuan terkunci setelah ada pergerakan.
   - barang tidak dihitung stok tidak membuat pergerakan dan tidak masuk opname.
   - membatalkan pengeluaran membalik stok; ditolak bila ada pergerakan sesudahnya.
   - `record_expense` payload lama tetap berhasil; payload baru dengan barang tanpa `stock_qty` ditolak.
   - kategori unik per bisnis; owner bisnis lain ditolak.
3. Jalankan seluruh suite: `sh supabase/tests/run_all.sh` dengan Postgres lokal. Tidak boleh ada `ERROR` atau `FAIL` baru. Untuk runner scratch: `scratchpad/pg/run.mjs`.

**Keluar Tahap 1:** semua tes 099 PASS; tes 041 sampai 045, 072, 073 yang memakai pengeluaran tetap PASS atau diperbarui dengan alasan tertulis.

## Tahap 2: BackOffice

1. **Menu Barang** (`routes/_app/barang.tsx`, baru): ganti label Bahan. Kolom: nama, kategori, satuan, dihitung stok, stok, harga rata-rata. `IngredientDialog` dipakai ulang dengan kolom satuan dan penanda; satuan dan penanda dikunci bila sudah ada pergerakan.
2. **Menu Resep** (`routes/_app/resep.tsx`, baru, atau tetap di `products.tsx` dengan `RecipeEditor`): hanya barang bertanda `dihitung_stok` yang bisa dipilih di resep.
3. **Hapus tab Belanja:** hapus `PurchaseDialog.tsx`, tab Belanja di `ingredients.tsx`, dan pemanggilan `saveRecipe`/`purchase` yang berkaitan. Riwayat belanja lama tidak ditampilkan lagi (data tidak dihapus).
4. **Pengeluaran** (`routes/_app/expenses.tsx`, `server/expenses.ts`):
   - tiap baris: barang (opsional, dropdown dari daftar barang), kategori (dropdown dari `expense_categories`), total bayar.
   - bila barang dihitung stok: kolom "Jumlah masuk stok" dalam satuan barang, sudah terisi dari kemasan bila ada, boleh diubah.
   - tombol "Masuk stok" dihapus; masuk stok terjadi saat pengeluaran disimpan.
5. **Kategori:** halaman kecil di Pengaturan, daftar dengan tambah, ubah nama, nonaktifkan. Tidak ada daftar kategori tetap di kode.
6. **Stock opname** (`CountDialog.tsx`, `stock.tsx`): daftar hanya barang `dihitung_stok`.
7. `dict.ts`: kunci baru untuk semua teks baru. Tes `reportText`/`stock` memeriksa cakupan terjemahan; jalankan ulang.
8. `lib/types.ts`, `server/normalize.ts`: tipe baru untuk barang dan kategori.

**Tes:** `apps/web/apps/backoffice/tests/` baru untuk: rumus rata-rata di sisi klien (jika ada pratinjau), filter barang opname, validasi input baris pengeluaran (stok harus > 0 bila dihitung). Lalu `npx tsc --noEmit`, `node --test tests/*.test.ts`, `npm run build`.

**Keluar Tahap 2:** owner bisa membuat barang, mencatat pengeluaran dengan barang dan jumlah nyata, dan melihat stok serta harga rata-rata berubah; opname hanya menampilkan barang yang dihitung stok.

## Tahap 3: App kasir

1. Sinkron daftar barang dan kategori: tambah ke `readCatalog`/`syncReference` seperti data referensi lain (`services/local/syncReference.ts`). Disimpan lokal, untuk dipakai saat offline.
2. `ExpenseSheet.tsx`: pilih barang dari daftar lokal (opsional), pilih kategori, isi total. Jumlah tidak diisi kasir; barang yang dihitung stok tetap masuk stok dari sisi owner, sesuai desain. **Catatan:** kasir tidak mengisi jumlah masuk stok karena jumlah nyata ditimbang oleh owner.
3. `repository.ts` `recordExpense` dan `offlineQueue.ts` kind `expense`: kirim `ingredientId` dan `category`. Format lama tetap dikirim selama APK lama masih beredar; tidak ada perubahan format yang memutus APK lama.
4. Tes: `tests/expense_test.js` dan `tests/offline_queue_test.js` diperbarui; tambah kasus barang kosong, kategori tidak dikenal, dan pengeluaran offline dengan barang.
5. `npm run test:js`, `npx tsc --noEmit`.

**Keluar Tahap 3:** kasir bisa memilih barang dan kategori saat offline dan saat online; pengeluaran sampai ke BackOffice.

## Rilis

1. Terapkan migrasi 099 ke Supabase (`cd apps/pos-mobile && npm run db:push`). Sebelum itu, cek nomor nota duplikat dari migrasi 097 (sudah menjadi catatan terbuka).
2. Deploy BackOffice.
3. Rilis APK/OTA kasir setelah BackOffice berjalan. Untuk OTA, ikuti `apps/pos-mobile/docs/archive/OTA_UPDATES.md`: migrasi harus lebih dulu.

## Risiko

- **Data lama:** `ingredient_moves` dan belanja lama tidak diubah. Stok sekarang tetap sama, hanya cara memasukkannya yang berubah.
- **Rantai pengeluaran:** pembatalan pengeluaran yang sudah masuk stok harus benar-benar membalik stok, bukan hanya menandai. Ini paling berisiko; tes wajib.
- **Pengeluaran kasir offline:** barang yang dipilih dari daftar lokal. Kalau barang dinonaktifkan di BackOffice saat kasir offline, pengeluaran tetap diterima dan barangnya dinilai saat sinkron; perlu diputuskan saat implementasi (tolak atau terima sebagai barang lama).
- **Satuan tidak dikonversi:** owner harus memilih satuan yang benar sejak awal. Tidak ada peringatan kalau minyak dicatat dalam gram tapi satuannya ml.

## Di luar rencana ini

- Selisih jumlah kemasan sebagai peringatan (ditunda oleh pemilik).
- Peringatan stok menipis dan laporan pemakaian teoritis.
- Penghapusan tabel belanja lama.
