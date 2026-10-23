# Tautan Pengeluaran ke Belanja Bahan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barang belanja yang sudah dicatat sebagai pengeluaran dari laci bisa dimasukkan ke stok bahan di BackOffice tanpa dicatat dua kali.

**Architecture:** Migrasi `089` menambah kolom `purchase_lines.expense_item_id` dan fungsi `owner_link_expense_items`, yang memanggil `owner_save_purchase` (jalur harga rata-rata dari 088, tidak diduplikasi), lalu menandai baris belanja. Pemicu `BEFORE DELETE` pada `expense_items` menolak pembatalan barang yang masih tertaut ke belanja aktif. Tabel pengeluaran dan fungsi 073 tidak diubah. BackOffice menambah aksi "Masuk stok" di halaman Pengeluaran.

**Tech Stack:** Postgres (`supabase/tests/test_089.sql`), TanStack Start + React + zod (`apps/web/apps/backoffice`).

**Spec:** `docs/superpowers/specs/2026-10-23-tautan-pengeluaran-belanja-design.md`

## Global Constraints

- Kas shift tidak berubah karena menautkan; hanya stok, harga rata-rata, dan HPP yang berubah.
- Total belanja tautan = jumlah barang pengeluaran persis (bukan diketik ulang).
- Satu barang tertaut paling banyak ke satu belanja aktif. Pembatalan belanja melepas tautan dengan sendirinya (baris tetap, belanja nonaktif).
- Hanya pemilik outlet (`assert_outlet_owner`); langganan berakhir mengunci tulis (`raise_expired` lewat `owner_save_purchase`).
- Fungsi baru `security definer`, `set search_path = public`, `revoke all ... from public, anon`, `grant ... to authenticated`.
- Teks Indonesia; setiap teks UI baru punya baris Inggris di `src/dict.ts`.
- Commit langsung di `main`, tanpa branch; jangan push. Trailer: `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Hanya stage `supabase` atau `apps/web`; jangan `.superpowers/`.
- Tes SQL: `/tmp/claude-1000/runsql.sh` (Postgres lokal di /tmp/pgt:54329). Baseline 835 PASS; sukses = tanpa FAIL/ERROR (test_070 P2/P3/D1 hanya boleh gagal setelah ~21:00).

## Review Focus

1. Kas shift setelah menautkan sama persis dengan sebelum menautkan.
2. Barang tertaut ke belanja aktif tidak bisa dibatalkan; setelah belanjanya dibatalkan, bisa.
3. Satu barang tidak bisa masuk dua belanja aktif, walau dalam panggilan yang sama dua kali.

---

### Task 1: SQL (migrasi 089 dan tes)

**Files:** Create `supabase/migrations/089_expense_stock_link.sql`, `supabase/tests/test_089.sql`

**Interfaces:**
- Produces: `purchase_lines.expense_item_id uuid null references expense_items(id)` (tanpa unique; diindeks); `owner_link_expense_items(p_outlet_id uuid, p_lines jsonb) returns jsonb` dengan `p_lines = [{"expenseItemId","ingredientId","packs"}]` (1 sampai 50, barang dan bahan masing-masing sekali per panggilan); hasil = hasil `owner_save_purchase` (id, boughtOn, total, lines) ditambah tanda tertaut; `owner_stock_links_for_expense(p_expense_id uuid) returns jsonb` berbentuk `[{"expenseItemId","purchaseId","ingredientId","ingredientName","packs","active"}]` untuk barang tertaut ke belanja mana pun (aktif atau tidak); pemicu `trg_expense_item_linked` BEFORE DELETE pada `expense_items` yang raise `Barang ini sudah masuk stok. Batalkan belanjanya dulu.` bila ada baris belanja aktif tertaut.
- Consumes: `owner_save_purchase` (088), `assert_outlet_owner`, `expense_items`, `expenses`, `shifts`, `ingredients`.

- [ ] **Step 1: Tes gagal dulu** di `test_089.sql` (pakai fixture seperti `test_088.sql`: pemilik, outlet, kasir, shift terbuka dengan kas awal 100.000, pengeluaran laci belanja SKM 36.000 dan barang operasional Plastik 15.000 lewat `record_expense` (pola `test_087.sql`), bahan SKM isi 370 g harga 18.000 per kemasan). Nama dan assert:
  - `L1 link`: `owner_link_expense_items` dengan SKM, packs 2 → belanja baru aktif; stok SKM 740; harga rata-rata 18000 per kemasan; total belanja 36000; `purchase_lines.expense_item_id` terisi.
  - `L2 cash unchanged` (Review Focus 1): kas seharusnya shift sama sebelum dan sesudah L1.
  - `L3 once only` (Review Focus 3): menautkan barang yang sama lagi, dan dalam satu panggilan dengan bahan lain, ditolak `sudah masuk stok`; dalam satu panggilan barang dobel ditolak.
  - `L4 not belanja`: barang operasional ditolak `Hanya barang belanja yang bisa masuk stok`.
  - `L5 one day`: dua barang dari shift hari berbeda ditolak `Pilih barang dari satu hari yang sama`.
  - `L6 cancel blocked` (Review Focus 2): `owner_cancel_expense_item` untuk barang tertaut ditolak `Batalkan belanjanya dulu`; kas tetap.
  - `L7 cancel purchase releases`: `owner_cancel_purchase` belanja tersebut, lalu barang bisa dibatalkan dan belanja ulang tertaut lagi (`L7b`).
  - `L8 other paid_from`: barang `other` bisa masuk stok; kas tidak berubah.
  - `L9 stock links`: `owner_stock_links_for_expense` mengembalikan tautan aktif dengan nama bahan dan jumlah kemasan.
  - `L10 owner-paid purchase unchanged`: `owner_save_purchase` biasa tetap bekerja tanpa tautan.
  - `X1 other business`: pemilik bisnis lain ditolak untuk tautan dan daftar tautan.
- [ ] **Step 2: Jalankan** suite. Expected: `FAIL`/`ERROR` pada L1 (fungsi belum ada).
- [ ] **Step 3: Implementasi** di `089_expense_stock_link.sql`: kolom dan indeks, fungsi `owner_link_expense_items` (validasi lalu panggil `owner_save_purchase` dengan lines `{ingredientId, packs, total = amount barang}` dan tanggal = tanggal bisnis shift barang; setelah itu isi `expense_item_id` lewat pemetaan bahan), `owner_stock_links_for_expense`, dan pemicu. Kunci: `assert_outlet_owner` dulu, lalu barang diurut id. Jangan ubah 073 atau 088.
- [ ] **Step 4: Jalankan** suite sampai hijau; semua tes 084 sampai 088 tetap lulus.
- [ ] **Step 5: Commit** `git add supabase && git commit -m "Link expense items to stock purchases (089)"`
- Laporan: `.superpowers/sdd/...` (tulis ke file laporan yang diminta controller).

---

### Task 2: BackOffice (Pengeluaran: aksi "Masuk stok")

**Files:** Modify `apps/web/apps/backoffice/src/server/expenses.ts` (atau server baru `src/server/expenseStock.ts`), `src/lib/schemas.ts`, `src/lib/types.ts`, `src/routes/_app/expenses.tsx`, `src/dict.ts`, `apps/web/e2e/mock-supabase.mjs`; Create `src/components/StockLinkDialog.tsx`; Test `tests/expenseStock.test.ts`.

**Interfaces:**
- Consumes: `owner_link_expense_items`, `owner_stock_links_for_expense`, `listIngredients`.
- Produces: `linkExpenseItemsSchema = { outletId, lines: [{ expenseItemId, ingredientId, packs }] }` (1 sampai 50; bahan dan barang sekali; packs 0 < n ≤ 999999 dengan maks 3 desimal, pesan Indonesia seperti skema stok); server fn `linkExpenseItems`, `listExpenseStockLinks`; `StockLinkDialog({ outletId, expense, onClose })` di tiap catatan pengeluaran yang punya barang belanja.

Tampilan: di setiap barang belanja di Pengeluaran: tag "Sudah masuk stok" (dengan nama bahan) atau tombol "Masuk stok" (bila belum tertaut). Dialog: daftar barang belanja belum tertaut, tiap baris: pilih bahan (dari daftar bahan outlet), jumlah kemasan (isian angka); baris kosong dilewati; "Simpan" hanya untuk baris yang diisi lengkap; tampilkan harga per kemasan yang dihitung (total barang ÷ packs) sebagai pratinjau. Barang operasional tidak punya tombol. Tanpa emoji. Label pada setiap input.

- [ ] **Step 1: Tes gagal dulu** `tests/expenseStock.test.ts`: skema menolak bahan kosong pada baris yang diisi, packs 0 dan 1.2345, barang dobel, lebih dari 50 baris; menerima satu baris sah; kamus untuk teks baru.
- [ ] **Step 2: Jalankan** `npm test -w @hermes-pos/backoffice`. Expected: FAIL.
- [ ] **Step 3: Implementasi** skema, tipe, server fn, mock stub, dialog, tag dan tombol di halaman Pengeluaran, terjemahan. Verifikasi: `npm test`, `npm run typecheck`, `npm run build` (dari `apps/web`), lalu `rm -rf apps/backoffice/.output`.
- [ ] **Step 4: Commit** `git add apps/web && git commit -m "Pengeluaran: link belanja items to stock"`
- Catat dengan jujur bagian yang tidak bisa diuji di browser (tidak ada browser di komputer ini).

---

### Task 3: Dokumen

**Files:** `README.md` (migrasi 089 setelah 088; langkah "Masuk stok"), `docs/PRD.md` (baris F16), `docs/ACCOUNTING.md` (3.1: barang belanja dari laci dicatat sekali di pengeluaran lalu ditautkan ke stok; kas tidak berubah).

- [ ] Perbarui ketiga dokumen singkat, Indonesia. Commit `git add README.md docs && git commit -m "Docs: expense to stock link (089)"`.

## Setelah semua tugas

Tinjauan akhir seluruh cabang oleh model paling mampu. Tidak ada push tanpa izin pemilik.
