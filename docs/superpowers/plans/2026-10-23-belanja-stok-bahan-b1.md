# Belanja Bahan dan Stok Bahan (rilis B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pemilik mencatat belanja bahan, stok tiap bahan berjalan (bertambah oleh belanja, berkurang oleh penjualan menu ber-resep), dan HPP menu mengikuti harga rata-rata dari stok yang ada.

**Architecture:** Satu migrasi `088_ingredient_stock_purchases.sql` menambah stok dan status mulai pada `ingredients`, log `ingredient_moves`, tabel `purchases` dan `purchase_lines`, serta fungsi `owner_*`. Harga rata-rata disimpan di `ingredients.price` (harga kemasan, dibulatkan 0,01) sehingga `recipe_cost` dan semua HPP menu tidak berubah. Pengurangan bahan saat penjualan dipasang lewat satu **constraint trigger tertunda** pada `transactions` (tidak menyentuh `complete_checkout`), dan koreksi bill ditangani di `owner_correct_bill`. BackOffice mendapat tab Belanja dan kolom stok di tab Bahan.

**Tech Stack:** Postgres/Supabase (plpgsql, `supabase/tests/test_*.sql`), TanStack Start + React + zod (`apps/web/apps/backoffice`, `node --test`).

**Spec:** `docs/superpowers/specs/2026-10-23-belanja-stok-bahan-design.md` (rilis B1 saja; B2 di bagian "Di luar rencana ini")

## Global Constraints

- Satuan dasar stok: g, ml, pcs (`unit_factor`: g=1, kg=1000, ml=1, l=1000, pcs=1). Jumlah belanja dalam **kemasan**: `base = kemasan × isi kemasan × faktor satuan kemasan`.
- Rata-rata bergerak saat belanja: `harga rata-rata baru per satuan dasar = (stok lama positif × rata-rata lama + total bayar) ÷ (stok lama positif + jumlah dasar yang dibeli)`; bila stok lama ≤ 0 atau stok belum berjalan, rata-rata baru = `total ÷ jumlah dasar`. Disimpan sebagai `price = round(rata-rata per satuan dasar × isi kemasan × faktor, 2)`. Penjualan tidak mengubah rata-rata.
- Stok **belum berjalan** sampai belanja pertama atau Hitung stok pertama pada bahan itu (`stock_started`). Selama belum berjalan: penjualan tidak mengurangi bahan, tampil "Belum dihitung", tidak ada angka negatif.
- **Penjualan tidak boleh gagal karena stok bahan.** Seluruh isi `trg_consume_ingredients()` dibungkus blok `begin ... exception when others then raise warning '...' end` (sub-transaksi), sehingga galat apa pun di pengurangan bahan membatalkan hanya pengurangan itu dan pembayaran tetap selesai.
- Bahan yang terpakai tidak pernah kembali: void bill, refund, dan koreksi yang mengurangi tidak mengembalikan bahan. Koreksi bill (yang membatalkan bill lama dan membuat bill baru) hanya mengurangi bahan sebesar **tambahan** per produk (bill baru dikurangi bill lama, tidak kurang dari 0).
- Setelah stok berjalan, harga bahan tidak bisa diketik (`Harga bahan ini mengikuti catatan belanja. Catat belanja untuk mengubahnya.`); sebelum itu tetap bisa diubah seperti sekarang.
- Hanya pemilik (`require_owner_business`, `is_owner_of_outlet`); langganan berakhir mengunci tulis (`raise_expired`). Semua fungsi baru `security definer`, `set search_path = public`, `revoke all ... from public, anon`, `grant execute ... to authenticated`; tabel baru RLS aktif dan `revoke all`.
- Urutan kunci: bahan (urut id) lebih dulu, lalu produk, seperti 086.
- Batas: catatan belanja ≤ 50 baris; jumlah kemasan > 0, ≤ 3 desimal, < 1.000.000; total bayar 0 sampai 1.000.000.000; tanggal belanja tidak di masa depan (zona waktu outlet), paling lama 90 hari ke belakang; satu bahan sekali per catatan.
- Pembatalan belanja: alasan 3 sampai 200 karakter; hanya bila tak ada belanja lebih baru (tidak dibatalkan) untuk bahan mana pun di dalamnya; pesan: `Sudah ada belanja setelahnya; batalkan yang terbaru dulu.`
- Istilah di layar: HPP dan satuan g, kg, ml, l, pcs; "kemasan" memakai **nama kemasan** bahan (bawaan "kemasan"). Teks UI dua bahasa (`src/dict.ts`).
- Kerja langsung di `main`, tanpa branch atau worktree. Commit lokal; jangan push kecuali diminta.
- Perintah bukti. Tes SQL (dari root repo): `PSQL="<psql> -h /tmp/pgt -p 54329 -U postgres" sh supabase/tests/run_all.sh` (butuh Postgres 16 lokal; lulus bila tidak ada `ERROR`/`FAIL`). BackOffice (dari `apps/web`): `npm test -w @hermes-pos/backoffice`, `npm run typecheck -w @hermes-pos/backoffice`, `npm run build -w @hermes-pos/backoffice`.

## Review Focus

1. Bill yang dikoreksi tidak mengurangi bahan dua kali untuk butir yang tidak berubah; butir tambahan mengurangi; butir yang dikurangi tidak mengembalikan. Dites di Task 2.
2. Void dan refund tidak mengembalikan bahan. Dites di Task 2.
3. Bahan yang belum berjalan tidak berubah oleh penjualan dan tidak pernah negatif; belanja atau hitung pertama memulainya. Dites di Task 1 sampai 3.
4. Membatalkan belanja yang bukan terbaru ditolak; yang terbaru memulihkan stok dan harga. Dites di Task 1.
5. Setelah belanja, HPP semua menu yang memakai bahan itu mengikuti rata-rata; harga tidak bisa diketik lagi. Dites di Task 1.

---

## File Structure

- Create `supabase/migrations/088_ingredient_stock_purchases.sql`, `supabase/tests/test_088.sql`
- Create `apps/web/apps/backoffice/tests/purchases.test.ts`
- Modify `apps/web/apps/backoffice/src/lib/types.ts`, `src/lib/schemas.ts`, `src/server/normalize.ts`, `src/server/ingredients.ts`, `src/components/IngredientDialog.tsx`, `src/routes/_app/ingredients.tsx` (kolom stok, tab Belanja, Hitung stok), `src/dict.ts`, `apps/web/e2e/mock-supabase.mjs`
- Create `apps/web/apps/backoffice/src/components/PurchaseDialog.tsx`, `src/components/CountDialog.tsx`
- Docs: `README.md`, `docs/PRD.md`, `docs/ACCOUNTING.md`

---

### Task 1: Skema, harga rata-rata, dan catatan belanja

**Files:**
- Create: `supabase/migrations/088_ingredient_stock_purchases.sql`
- Create: `supabase/tests/test_088.sql` (gaya `test_084.sql`: helper `pg_temp.ok`/`pg_temp.fails`, fixture pemilik dan outlet, bahan dan produk dengan resep es kopi susu)

**Interfaces:**
- Produces (tabel): `ingredients` + `stock numeric(16,3) not null default 0`, `stock_started boolean not null default false`, `pack_label text` (maks 20); `ingredient_moves(id, ingredient_id → ingredients on delete restrict, outlet_id, kind in ('purchase','purchase_cancel','sale','opening','count'), qty numeric(16,3) [selisih bertanda, satuan dasar], counted numeric(16,3) [untuk opening dan count], doc_id uuid, at timestamptz default now(), created_by uuid)`; `purchases(id, outlet_id, bought_on date, total numeric(14,2), created_by, created_at, cancelled_at, cancel_reason)`; `purchase_lines(id, purchase_id → purchases on delete cascade, ingredient_id → ingredients on delete restrict, packs numeric(14,3), total numeric(14,2), base_qty numeric(16,3), price_before numeric(14,2), price_after numeric(14,2))`, unik `(purchase_id, ingredient_id)`.
- Produces (fungsi): `owner_save_purchase(p_outlet_id uuid, p_bought_on date, p_lines jsonb) returns jsonb` dengan `p_lines = [{"ingredientId","packs","total"}]`, hasil `{"id","boughtOn","total","cancelledAt","lines":[{"ingredientId","name","packLabel","packs","total","priceBefore","priceAfter"}]}`; `owner_cancel_purchase(p_purchase_id uuid, p_reason text) returns jsonb` (bentuk sama); `owner_list_purchases(p_outlet_id uuid, p_page int default 1) returns jsonb` → `{"rows":[purchase...],"total":int}`, 50 per halaman, terbaru dulu; `owner_list_ingredients(p_outlet_id uuid)` ditambah `stock`, `stockStarted`, `packLabel`, `lastCountedAt` (waktu `opening`/`count` terakhir atau null); `owner_save_ingredient(p_outlet_id uuid, p_id uuid, p_name text, p_price numeric, p_pack_qty numeric, p_pack_unit text, p_pack_label text default null) returns uuid` menggantikan versi 6 argumen (`drop function public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text)` lebih dulu; ulangi `revoke`/`grant`). `owner_preview_ingredient` menolak perubahan harga bahan yang stoknya berjalan dengan pesan yang sama.

- [ ] **Step 1: Tulis tes yang gagal** di `test_088.sql`. Fixture: bahan Kopi (120000/1 kg), Susu (18000/1 l), Gula aren (30000/1 kg), Gelas (1200/1 pcs), SKM (18000 per kemasan isi 370 g, `pack_label` "kaleng"); produk "Es kopi susu" ber-resep (18 g kopi, 150 ml susu, 15 g gula, 1 pcs gelas) lewat `owner_save_recipe`. Nama dan assert:
  - `G1 grants`: tiga fungsi belanja dan `owner_list_ingredients` boleh `authenticated`, tidak `anon`.
  - `P1 first purchase starts the stock`: beli 12 kemasan susu total 204000 (17.000/liter) → `stock` = 12000, `stock_started`, `price` = 17000, HPP es kopi susu = 6510 − 150×(18−17) = 6360; ada satu `ingredient_moves` `purchase`.
  - `P2 moving average` (contoh pemilik): stok susu 2000 ml di harga 18.000/l, beli 1 l total 22.000 → `price` = 19333.33, stok 3000 ml; HPP menu mengikuti (Review Focus 5).
  - `P3 stock <= 0 resets the average`: paksa stok 0 lewat tabel (superuser), beli 1 l total 22.000 → `price` 22000.
  - `P4 pack arithmetic`: SKM 2 kemasan total 36000 → stok 740 g, `price` 18000.
  - `P5 price locked once running`: `owner_save_ingredient` mengubah harga bahan berjalan galat `mengikuti catatan belanja`; bahan belum berjalan tetap bisa; `pack_label` bisa diubah; `owner_preview_ingredient` galat sama.
  - `P6 cancel the latest` (Review Focus 4): batalkan belanja terakhir dengan alasan → stok dan `price` kembali ke nilai sebelum belanja itu, HPP menu kembali; belanja ditandai batal; `purchase_cancel` tercatat.
  - `P7 cancel an older one is refused`: dua belanja susu berurutan, membatalkan yang lama galat `Sudah ada belanja setelahnya`.
  - `P8 validation`: baris 0, 51 baris, `packs` 0 / 1.2345 / 1e6, total negatif, bahan dobel, bahan outlet lain, tanggal besok, tanggal 91 hari lalu, alasan batal 2 huruf: masing-masing galat dengan pesan yang jelas, dan tidak ada belanja setengah tersimpan.
  - `P9 list`: `owner_list_purchases` memuat belanja terbaru dulu dengan `total`.
  - `P10 rounding`: harga rata-rata disimpan 2 desimal dan stok 3 desimal (belanja 3 kemasan Rp100 isi 3 g tidak hilang).
  - `X1 another business`: pemilik lain ditolak untuk simpan, batal, daftar; `Sesi kasir tidak valid`.
- [ ] **Step 2: Jalankan** `run_all.sh`. Expected: gagal (objek belum ada).
- [ ] **Step 3: Tulis migrasi 088 bagian ini:** tabel, kolom, fungsi di atas. `owner_save_purchase` mengunci bahan terpilih `for update` urut id, menghitung seperti Global Constraints, mengisi `purchase_lines` (`price_before`/`price_after`), memperbarui `ingredients` (`stock`, `price`, `stock_started = true`), menulis `ingredient_moves`, lalu `recompute_hpp` untuk semua produk yang memakai bahan itu (urut id). Pembatalan memulihkan `price` dari `price_before`, mengurangi stok sebesar `base_qty`, menulis `purchase_cancel`, dan menghitung ulang HPP.
- [ ] **Step 4: Jalankan** `run_all.sh`. Expected: semua `PASS`, tanpa `ERROR`/`FAIL` (tes 084 sampai 087 tetap lulus; sesuaikan `test_084.sql` bila `owner_list_ingredients` atau `owner_save_ingredient` berubah bentuk).
- [ ] **Step 5: Commit** `git add supabase && git commit -m "Ingredient purchases with a moving average price (088)"`

---

### Task 2: Pengurangan bahan oleh penjualan dan koreksi bill

**Files:**
- Modify: `supabase/migrations/088_ingredient_stock_purchases.sql`, `supabase/tests/test_088.sql`

**Interfaces:**
- Consumes: skema Task 1; `public.owner_correct_bill` (versi 073, satu-satunya definisi); tabel `transactions` (`status`, `completed_at`), `transaction_items(transaction_id, product_id, quantity)`.
- Produces: `consume_ingredients(p_transaction uuid, p_items jsonb) returns void` (internal, `revoke all` dari semua), `p_items = [{"productId","qty"}]`: untuk tiap produk ber-resep (`hpp_source = 'recipe'`) dan tiap baris resep, kurangi `ingredients.stock` sebesar `qty × resep.qty × unit_factor(resep.unit)` hanya untuk bahan yang `stock_started`, kunci bahan urut id, tulis `ingredient_moves` `sale` (`doc_id` = id transaksi); `trg_consume_ingredients()` + `create constraint trigger ... after insert or update of status on public.transactions deferrable initially deferred for each row when (new.status = 'completed')` yang memanggil `consume_ingredients` dengan semua butir bill bila `tg_op = 'INSERT'` atau status sebelumnya bukan `completed`, **kecuali** `current_setting('hermes.skip_ingredients', true) = '1'`, dan tidak mengulang bila sudah ada move `sale` untuk transaksi itu; `owner_correct_bill` versi baru: sama dengan 073, tetapi sebelum membuat bill baru memanggil `set_config('hermes.skip_ingredients', '1', true)` lalu, setelah butir bill baru jadi, memanggil `consume_ingredients(v_new, <selisih positif per produk bill baru dikurangi bill lama>)`.

- [ ] **Step 1: Tulis tes yang gagal** (pakai fixture kasir, shift, dan `complete_checkout` seperti `test_074.sql`; bahan susu berjalan stoknya 12000 ml lewat belanja):
  - `S1 a sale consumes`: jual 2 es kopi susu → susu 12000 − 300 = 11700 ml, kopi dan lainnya berkurang sesuai resep, move `sale` per bahan; harga rata-rata tidak berubah.
  - `S2 not started is untouched`: bahan yang belum berjalan tidak berkurang dan tidak punya move (Review Focus 3).
  - `S3 manual product`: produk tanpa resep tidak mengurangi bahan.
  - `S4 held bill`: bill ditahan lalu dibayar mengurangi sekali, saat dibayar; bill yang hanya ditahan tidak mengurangi.
  - `S5 void does not return` dan `S6 refund does not return` (Review Focus 2): void bill dan refund butir tidak mengubah stok bahan.
  - `S7 correction adds only the extra` (Review Focus 1): bill 2 es kopi susu dikoreksi menjadi 3 → bahan berkurang hanya untuk 1 tambahan; dikoreksi menjadi 1 → tidak ada pengembalian dan tidak ada pengurangan.
  - `S8 deferred trigger is idempotent`: dua kali `update transactions set status = 'completed'` pada bill yang sama dalam satu transaksi tidak menggandakan move.
  - `S9 recipe edited later`: mengubah resep setelah penjualan tidak mengubah stok bahan yang sudah terpakai.
  - `S10 a failing consumption never blocks the sale`: pasang sementara `alter table public.ingredients add constraint tmp_block check (stock >= 1e12) not valid`, bayar satu bill ber-resep (bill selesai, tidak ada galat, stok dan move bahan tidak berubah, ada peringatan), lalu `drop constraint tmp_block`.
- [ ] **Step 2: Jalankan** `run_all.sh`. Expected: `FAIL` pada `S1`, `S7`, `S10`.
- [ ] **Step 3: Implementasi** `consume_ingredients`, constraint trigger, dan `owner_correct_bill` baru (salin 073, ubah seperlunya; periksa dulu bahwa tidak ada definisi lebih baru: `grep -n "owner_correct_bill" supabase/migrations/*.sql`).
- [ ] **Step 4: Jalankan** `run_all.sh`. Expected: semua `PASS`, termasuk tes 073 dan 074 yang memakai penjualan dan koreksi.
- [ ] **Step 5: Commit** `git add supabase && git commit -m "Sales and corrections consume ingredient stock (088)"`

---

### Task 3: Hitung stok bahan

**Files:**
- Modify: `supabase/migrations/088_ingredient_stock_purchases.sql`, `supabase/tests/test_088.sql`

**Interfaces:**
- Produces: `owner_count_ingredients(p_outlet_id uuid, p_lines jsonb) returns jsonb` dengan `p_lines = [{"ingredientId","qty","unit"}]` (qty ≥ 0, ≤ 3 desimal, < 1.000.000.000, unit satu jenis dengan satuan kemasan bahan; ≤ 200 baris; bahan sekali per dokumen), hasil `{"lines":[{"ingredientId","name","kind","before","after","diff","value"}]}`: `kind = 'opening'` bila bahan belum berjalan (mengganti saldo dengan hasil hitung, memulai stok, move `opening`, `diff` = after, nilai 0), selain itu `kind = 'count'` (`diff = after − stok`, move `count`, `stock = after`, `value = diff × rata-rata per satuan dasar`); semua move satu dokumen berbagi `doc_id` baru. Tidak memposting buku besar (B2).

- [ ] **Step 1: Tulis tes yang gagal:** `C1 first count is an opening` (bahan belum berjalan dihitung 5000 ml → stok 5000, `stock_started`, kind opening, nilai 0, tidak ada kerugian); `C2 later count books the difference` (stok 11700 dihitung 11000 → diff −700, nilai −700 × 17 = −11900, stok 11000, move `count`); `C3 average unchanged by a count`; `C4 units`: hitung dalam kg/l dikonversi, jenis salah ditolak; `C5 limits`: qty negatif, 4 desimal, bahan dobel, bahan outlet lain, 201 baris ditolak; `C6 negative stock fixed`: stok −300 dihitung 1000 → diff 1300; `C7 last counted`: `lastCountedAt` pada `owner_list_ingredients` terisi; `C8 another business` ditolak.
- [ ] **Step 2: Jalankan** `run_all.sh`. Expected: gagal.
- [ ] **Step 3: Implementasi** fungsi dan perluasan `owner_list_ingredients` bila belum memuat `lastCountedAt`.
- [ ] **Step 4: Jalankan** `run_all.sh`. Expected: semua `PASS`.
- [ ] **Step 5: Commit** `git add supabase && git commit -m "Count ingredient stock (088)"`

---

### Task 4: Tipe, skema, dan server function BackOffice

**Files:**
- Create: `apps/web/apps/backoffice/tests/purchases.test.ts`
- Modify: `src/lib/types.ts`, `src/lib/schemas.ts`, `src/server/normalize.ts`, `src/server/ingredients.ts`, `src/dict.ts`, `apps/web/e2e/mock-supabase.mjs`

**Interfaces:**
- Produces (TS): `Ingredient` ditambah `stock: number`, `stockStarted: boolean`, `packLabel: string`, `lastCountedAt: string | null`; `Purchase = { id; boughtOn: string; total: number; cancelledAt: string | null; lines: PurchaseLine[] }`, `PurchaseLine = { ingredientId; name; packLabel; packs; total; priceBefore; priceAfter }`, `PurchaseList = { rows: Purchase[]; total: number }`, `CountResultLine = { ingredientId; name; kind: 'opening' | 'count'; before; after; diff; value }`; skema zod `purchaseSchema = { outletId, boughtOn (tanggal), lines: [{ ingredientId, packs, total }] }` dengan batas Global Constraints dan pesan Indonesia seperti skema stok (`Jumlah harus angka.`, `Jumlah maksimal 3 angka di belakang koma.`, dst.), `purchaseCancelSchema = { id, reason (3 sampai 200) }`, `countSchema = { outletId, lines: [{ ingredientId, qty, unit }] }`, `purchaseListSchema = { outletId, page }`; `ingredientSchema` ditambah `packLabel` (trim, ≤ 20, boleh kosong); server function `listPurchases`, `savePurchase`, `cancelPurchase`, `countIngredients` (gaya `server/stock.ts`; `saveIngredient` mengirim `p_pack_label`).

- [ ] **Step 1: Tulis tes yang gagal** `tests/purchases.test.ts`: `purchaseSchema` menerima belanja sah (SKM 2 kemasan total 36000); menolak 0 baris, 51 baris, `packs` 0 / 1.2345 / 1000000, total negatif atau NaN, bahan dobel, tanggal bukan `YYYY-MM-DD`; `purchaseCancelSchema` menolak alasan 2 huruf; `countSchema` menerima 0 dan menolak negatif, 4 desimal, satuan `sdm`; `ingredientSchema` menolak `packLabel` 21 huruf; tes kamus untuk semua teks UI Task 5 dan 6 (daftar disusun di tes, gagal sampai teks ditambahkan di Task 5 dan 6, jadi pada task ini cukup kunci yang sudah dipakai kode Task 4).
- [ ] **Step 2: Jalankan** `npm test -w @hermes-pos/backoffice`. Expected: FAIL.
- [ ] **Step 3: Implementasi** tipe, skema, mapper di `normalize.ts` (`toPurchase`, `toPurchaseList`, `toCountLine`; `toIngredient` memuat kolom baru), server function, dan stub mock (`owner_save_purchase`, `owner_cancel_purchase`, `owner_list_purchases`, `owner_count_ingredients`).
- [ ] **Step 4: Jalankan** `npm test -w @hermes-pos/backoffice` dan `npm run typecheck -w @hermes-pos/backoffice`. Expected: lulus dan bersih.
- [ ] **Step 5: Commit** `git add apps/web && git commit -m "Purchases and ingredient stock: types, schemas, server functions"`

---

### Task 5: Tab Bahan — stok, harga rata-rata, Hitung stok

**Files:**
- Modify: `src/routes/_app/ingredients.tsx`, `src/components/IngredientDialog.tsx`, `src/dict.ts`
- Create: `src/components/CountDialog.tsx`

**Interfaces:**
- Consumes: `Ingredient` (Task 4), `countIngredients`, `countSchema`, `sameFamilyUnits`, `UNIT_LABEL`.
- Produces: `CountDialog({ outletId, items, onClose }: { outletId: string; items: Ingredient[]; onClose: () => void })`.

Tampilan (ikuti pola `stock.tsx` dan `DocumentDialog`; tanpa emoji; tap target 44 px; kontras AA):
- Tabel Bahan: kolom Bahan, Stok (angka dengan satuan dasar yang enak dibaca: ≥ 1000 g tampil kg; "Belum dihitung" bila `!stockStarted`; merah bila negatif), Harga rata-rata (`price` per kemasan dengan nama kemasan, mis. "Rp18.000 / kaleng"), Terakhir dihitung (tanggal atau "belum pernah"), Dipakai di, Aksi. Tombol "Hitung stok" di atas tabel.
- `IngredientDialog`: isian "Nama kemasan (opsional)" (mis. kaleng, pcs, dus); bila `ingredient.stockStarted`, isian Harga beli tidak bisa diketik dan memakai teks bantuan "Mengikuti catatan belanja. Catat belanja untuk mengubahnya."
- `CountDialog`: daftar bahan, tiap baris isian jumlah dan pemilih satuan (satu jenis dengan satuan kemasan, bawaan satuan dasar terbaca), keterangan "stok sistem" atau "belum dihitung: ini jadi stok awal"; hanya baris berisi yang disimpan; setelah simpan tampil ringkasan selisih per bahan dengan nilainya ("kurang 700 ml, Rp11.900"); keadaan kosong, memuat, dan galat memakai pola halaman lain.
- Teks Indonesia di `dict.ts` dengan terjemahan Inggris.

- [ ] **Step 1: Tulis tes yang gagal:** tes kamus di `purchases.test.ts` untuk semua teks baru Task 5 (`Hitung stok`, `Stok`, `Harga rata-rata`, `Terakhir dihitung`, `belum pernah`, `Belum dihitung`, `Nama kemasan (opsional)`, `Mengikuti catatan belanja. Catat belanja untuk mengubahnya.`, teks CountDialog dan ringkasan, dst.).
- [ ] **Step 2: Jalankan** `npm test -w @hermes-pos/backoffice`. Expected: FAIL pada kunci yang belum ada.
- [ ] **Step 3: Implementasi** kolom tabel, perubahan dialog, `CountDialog`, dan terjemahan. Format angka stok lewat satu fungsi kecil di `lib/units.ts` (`stockText(base, baseUnit)`), dengan tes unitnya di `purchases.test.ts` (mis. `stockText(12000, 'ml') = '12 l'`, `stockText(740, 'g') = '740 g'`, `stockText(-300, 'ml') = '-300 ml'`, `stockText(2.5, 'pcs') = '2,5 pcs'` dengan koma desimal).
- [ ] **Step 4: Verifikasi:** `npm test`, `npm run typecheck`, `npm run build -w @hermes-pos/backoffice`. Bila ada browser (atau `npm run mock` + `npm run dev:backoffice`): tab Bahan menampilkan kolom baru, "Belum dihitung" untuk bahan tanpa belanja, Hitung stok pertama menjadi stok awal. Bila tidak ada browser, katakan dan tandai belum diuji.
- [ ] **Step 5: Commit** `git add apps/web && git commit -m "Bahan tab shows stock and average price; Hitung stok"`

---

### Task 6: Tab Belanja

**Files:**
- Modify: `src/routes/_app/ingredients.tsx`, `src/dict.ts`
- Create: `src/components/PurchaseDialog.tsx`

**Interfaces:**
- Consumes: `savePurchase`, `listPurchases`, `cancelPurchase`, `purchaseSchema`, `purchaseCancelSchema`, `Purchase`, `Ingredient`, `IngredientDialog`.
- Produces: tab ketiga "Belanja" di `/ingredients` (`search.tab = 'belanja'`, `search.page`), `PurchaseDialog({ outletId, ingredients, onClose })`.

Tampilan:
- Daftar: tanggal belanja, ringkasan bahan ("Susu 12 kemasan, SKM 2 kaleng, +2"), total; baris batal dicoret dengan label "dibatalkan"; tombol "Catat belanja"; aksi "Lihat" membuka rincian (baris dengan harga sebelum dan sesudah, total) dan, bila bisa, "Batalkan" dengan alasan. Paging 50.
- `PurchaseDialog` (lebar): tanggal (bawaan hari ini, tidak melebihi hari ini, paling lama 90 hari ke belakang), tabel baris: bahan (pilihan + "+ Bahan baru" membuka `IngredientDialog`), jumlah (dalam nama kemasan bahan, mis. "2 kaleng"), **total bayar dan harga per kemasan yang saling menghitung** (mengisi salah satu mengisi yang lain; pembulatan 2 desimal), keterangan isi kemasan, tombol hapus baris; "Tambah bahan"; total belanja; Simpan. Tidak ada pilihan "Dibayar dari". Setelah simpan, toast menyebut berapa bahan yang HPP menunya ikut berubah bila ada.
- Pembatalan: dialog alasan; galat `Sudah ada belanja setelahnya` ditampilkan apa adanya (terjemah lewat kamus).

- [ ] **Step 1: Tulis tes yang gagal:** tes kamus untuk semua teks baru Task 6 ditambah tes murni untuk perhitungan total/harga per kemasan: `pairFromTotal(total, packs)` dan `pairFromUnit(unitPrice, packs)` di `lib/units.ts` (atau `lib/purchase.ts`): `(36000, 2) → { total: 36000, unit: 18000 }`, `pairFromUnit(18000, 2)` → `{ total: 36000, unit: 18000 }`, `pairFromTotal(100, 3)` → unit `33.33`, packs 0 atau kosong → null.
- [ ] **Step 2: Jalankan** `npm test -w @hermes-pos/backoffice`. Expected: FAIL.
- [ ] **Step 3: Implementasi** tab, `PurchaseDialog`, dialog rincian dan batal, terjemahan, pemuatan data (`loader` memuat `listPurchases` bila `tab = 'belanja'`).
- [ ] **Step 4: Verifikasi:** `npm test`, `npm run typecheck`, `npm run build`. Uji tampilan bila ada browser; bila tidak, tandai belum diuji.
- [ ] **Step 5: Commit** `git add apps/web && git commit -m "Belanja tab: record, view, and cancel purchases"`

---

### Task 7: Dokumen dan verifikasi akhir

**Files:** `README.md`, `docs/PRD.md`, `docs/ACCOUNTING.md`

- [ ] **Step 1: Perbarui dokumen:** README (migrasi 088 sebelum BackOffice yang baru; ringkas fitur), PRD (baris F15: Belanja bahan dan stok bahan, rilis B1; sebut yang belum: ledger/laba rugi bahan, batas stok menipis, riwayat dokumen), ACCOUNTING 3.1 (HPP kini mengikuti harga rata-rata dari stok; bahan terpakai tidak kembali; selisih hitung bahan belum masuk laba rugi sampai B2).
- [ ] **Step 2: Verifikasi penuh:** `run_all.sh` (tanpa `ERROR`/`FAIL`), `npm test`, `npm run typecheck`, `npm run build` BackOffice.
- [ ] **Step 3: Commit** `git add -A README.md docs && git commit -m "Docs: ingredient purchases and stock (088)"`
- [ ] **Step 4: Ringkas** untuk pemilik: migrasi 088 diterapkan ke Supabase dulu (ia menambah kolom dan trigger; terapkan ke proyek uji lebih dulu), baru BackOffice baru dipakai. Tidak ada perubahan POS dan tidak perlu APK baru. Tidak ada push.

---

## Di luar rencana ini (rilis B2)

Batas stok menipis dan penyaring "Tinggal sedikit"; dokumen penyesuaian dengan alasan; riwayat dokumen stok bahan; selisih hitung dan penyesuaian bahan masuk Penyesuaian stok di buku besar dan laba rugi (`ledger`, `report_pnl`) dan cek P7 untuk bahan. Disusun sebagai rencana terpisah setelah B1 dipakai.
