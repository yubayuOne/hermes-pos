# Pengeluaran Kembali di Aplikasi POS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasir mencatat pengeluaran di POS (dari kas laci atau bukan), uang laci yang seharusnya ikut berkurang, dan pemilik bisa memilih sumber uang lagi di BackOffice.

**Architecture:** Hampir semua kode pernah ada dan dicabut oleh commit `d0fd8a1` ("Cashier app for sales only, no day close (077, 078)"). Rencana ini **mengembalikan hanya bagian pengeluaran** dengan menerapkan balik (`git apply -R`) potongan per berkas dari commit itu, tidak men-*revert* seluruh commit (tutup hari, migrasi 078, dan 079 tetap). Satu migrasi baru `087` mengaktifkan lagi `record_expense` dan pilihan `drawer` di `owner_add_expense_items`; fungsi buku kas (`_073_sync_expense`, `expense_json`, `owner_cancel_expense_item`) tidak berubah.

**Tech Stack:** Postgres/Supabase (plpgsql, `supabase/tests/test_*.sql`), React Native/Expo POS (`apps/pos-mobile`, tes `node tests/*.js`, `tsc`, `scripts/i18n-check.js`), BackOffice TanStack Start + zod (`apps/web/apps/backoffice`, `node --test`).

**Spec:** `docs/superpowers/specs/2026-10-23-pengeluaran-pos-kembali-design.md`

## Global Constraints

- Urutan rilis: **migrasi 087 diterapkan dulu, baru APK baru.** APK lama tidak memanggil `record_expense`, jadi tidak rusak.
- Jangan mengubah migrasi yang sudah ada (077 sampai 086). Satu berkas migrasi baru: `087_cashier_expenses_back.sql`.
- Tutup hari tetap hilang: jangan mengembalikan apa pun dari `078_no_day_close.sql`, `test_075.sql`, `test_076.sql`, `closing.test.ts`, `Bell.tsx`, `AppShell.tsx`.
- Aturan uang: `uang laci seharusnya = modal awal + penjualan tunai + kas masuk − refund tunai − kas keluar manual − pengeluaran dari laci`. Pengeluaran bukan dari laci tidak mengubah kas.
- Isian lembar pengeluaran tetap ringan: jumlah bawaan 1, satuan bawaan pcs, kategori bawaan belanja, sumber bawaan kas laci; hanya nama dan total yang wajib.
- Pengeluaran yang antre offline dikirim sekali (kunci idempotensi yang sama). Entri `expense` yang disisihkan APK era 077 (`${QUEUE_KEY}:expense`) **tidak** dikirim ulang.
- Teks UI dua bahasa: `src/i18n/en.ts` (POS, lulus `npm run i18n:check`) dan `src/dict.ts` (BackOffice).
- Kerja langsung di `main`, tanpa branch atau worktree. Commit lokal; jangan push kecuali diminta.
- Perintah bukti. Tes SQL (dari root repo): `PSQL="<psql> -h /tmp/pgt -p 54329 -U postgres" sh supabase/tests/run_all.sh` (butuh Postgres 16 lokal; lulus bila tidak ada baris `ERROR`/`FAIL`). POS (dari `apps/pos-mobile`): `npm run test:js`, `npx tsc --noEmit`, `npm run i18n:check`. BackOffice (dari `apps/web`): `npm test -w @hermes-pos/backoffice`, `npm run typecheck -w @hermes-pos/backoffice`.

## Review Focus

1. Shift ditutup dengan pengeluaran laci: uang seharusnya turun persis sebesar itu, dan pengeluaran "bukan dari laci" tidak mengubahnya. Dites di Task 1.
2. Pemilik menambah pengeluaran laci ke shift yang **sudah ditutup**: kas seharusnya dan selisih dihitung ulang, buku kas tetap seimbang. Dites di Task 1.
3. Kirim ulang dengan kunci idempotensi yang sama (HP offline mengirim dua kali) mencatat sekali. Dites di Task 1 dan Task 2.
4. Membatalkan butir pengeluaran laci oleh pemilik mengembalikan kas dan `ledger_checks` bersih. Dites di Task 1.
5. Entri `expense` lama yang disisihkan di HP (era 077) tidak ikut terkirim saat antrean dimuat. Dites di Task 2.

---

## File Structure

- Create `supabase/migrations/087_cashier_expenses_back.sql`, `supabase/tests/test_087.sql`
- Modify `supabase/tests/test_041.sql`, `test_042.sql`, `test_043.sql`, `test_045.sql`, `test_072.sql`, `test_073.sql` (kembali ke versi uji pengeluaran), `test_077.sql` (keputusan baru)
- Restore (dari `d0fd8a1^`) di `apps/pos-mobile`: `src/screens/shift/ExpenseSheet.tsx`, `src/utils/expense.ts`, `tests/expense_test.js`
- Modify (terapkan balik hunk pengeluaran) di `apps/pos-mobile`: `src/types/domain.ts`, `src/services/transaction/repository.ts`, `src/services/transaction/offlineQueue.ts`, `src/services/local/shiftData.ts`, `src/screens/shift/ShiftScreen.tsx`, `src/screens/shift/ShiftReportScreen.tsx`, `src/utils/shiftReport.ts`, `src/components/overlays.tsx`, `src/screens/sell/SellScreen.tsx` (komentar), `src/i18n/en.ts`, `package.json` (`test:js`), `tests/offline_queue_test.js`, `tests/shift_report_test.js`, `tests/shift_data_test.js`, `e2e/mock-supabase.mjs`, `README.md`
- Modify di `apps/web/apps/backoffice`: `src/lib/schemas.ts` (`expenseAddSchema`), `src/server/expenses.ts`, `src/routes/_app/expenses.tsx`, `src/dict.ts`, `tests/` (tes skema)
- Modify docs: `README.md`, `docs/ACCOUNTING.md`, `docs/PRD.md`, `docs/DESIGN.md` bagian yang menyebut "pengeluaran tidak dari laci" atau "aplikasi kasir hanya penjualan"

Cara menerapkan balik satu berkas: `git diff d0fd8a1^ d0fd8a1 -- <path> | git apply -R --3way`. Bila ada konflik, selesaikan secara manual dengan acuan `git show d0fd8a1^:<path>` dan jaga perubahan sesudah `d0fd8a1`. Berkas yang dihapus penuh (`ExpenseSheet.tsx`, `expense.ts`, `expense_test.js`): `git checkout d0fd8a1^ -- <path>`.

---

### Task 1: Database — `record_expense` kembali, pilihan `drawer` untuk pemilik

**Files:**
- Create: `supabase/migrations/087_cashier_expenses_back.sql`
- Create: `supabase/tests/test_087.sql` (gaya `test_080.sql`: `pg_temp.ok` dan `pg_temp.fails`)
- Modify: `supabase/tests/test_041.sql`, `test_042.sql`, `test_043.sql`, `test_045.sql`, `test_072.sql`, `test_073.sql`, `test_077.sql`

**Interfaces:**
- Produces: kasir (`authenticated`) bisa `public.record_expense(p_shift_id uuid, p_cashier_id uuid, p_outlet_id uuid, p_paid_from text, p_items jsonb, p_idempotency_key text) returns jsonb` lagi; `public.owner_add_expense_items(p_shift_id uuid, p_paid_from text, p_items jsonb) returns jsonb` menerima `'drawer'` dan `'other'` (isi sama dengan versi 073, `p_paid_from in ('drawer','other')`, pesan `Pilih sumber uang: kas laci atau bukan dari laci.`). Fungsi lain tidak diubah.

- [ ] **Step 1: Kembalikan tes pengeluaran lama (merah dulu).** Untuk `test_041`, `test_042`, `test_043`, `test_045`, `test_072`: `git diff d0fd8a1^ d0fd8a1 -- supabase/tests/test_NNN.sql | git apply -R`. Untuk `test_073`: terapkan balik hanya hunk E1 (pembuatan pengeluaran laci lewat `record_expense` kembali menggantikan insert langsung). **Jangan** menerapkan balik `test_075` dan `test_076` (isinya perubahan tutup hari).
- [ ] **Step 2: Tulis `test_087.sql`** (fixture seperti `test_074.sql`: pemilik, outlet, kasir, `open_shift`, langganan `monthly`). Nama dan assert:
  - `S1 grants`: `authenticated` boleh `record_expense(uuid, uuid, uuid, text, jsonb, text)`; `anon` tidak.
  - `E1 cashier drawer expense`: modal 100.000, kasir mencatat `record_expense(... 'drawer', [Gula, belanja, 1, kg, 30000], 'k-1')` → kas seharusnya shift = 70.000 (Review Focus 1).
  - `E2 not from drawer`: `record_expense(... 'other', [Plastik, operasional, 1, pack, 15000], 'k-2')` → kas tetap 70.000.
  - `E3 replay`: panggilan ulang `k-1` memberi hasil sama dan kas tetap 70.000, hanya satu butir (Review Focus 3).
  - `E4 close`: `close_shift` dengan uang dihitung 70.000 → selisih 0; dengan 100.000 → selisih 30.000.
  - `O1 owner drawer`: `owner_add_expense_items(shift, 'drawer', [Telur, belanja, 2, kg, 20000])` pada shift terbuka → kas seharusnya turun 20.000; `'other'` tidak mengubahnya; `'lain'` ditolak (`Pilih sumber uang`).
  - `O2 closed shift` (Review Focus 2): pada shift yang sudah ditutup, `owner_add_expense_items(... 'drawer' ...)` menghitung ulang kas seharusnya dan selisih.
  - `C1 cancel` (Review Focus 4): `owner_cancel_expense_item` pada butir laci membalik baris buku kas, kas naik kembali sebesar butir itu.
  - `L1 ledger`: `ledger_checks` untuk outlet itu bersih (tanpa baris gagal) setelah semua langkah.
  - `X1 isolation`: pemilik bisnis lain ditolak (`Shift tidak ditemukan`); kasir shift lain ditolak oleh `record_expense`.
- [ ] **Step 3: Perbarui `test_077.sql`:** hapus atau balik assert yang menyatakan kasir tidak boleh `record_expense` (`S1`, `R1`) dan pemilik tidak boleh mengambil dari laci (`A1`, `A2`, `A3`); pertahankan assert yang masih benar (`C1`, `L1` sampai `L3`: pengeluaran laci lama, pembatalan, `ledger_checks`). Jelaskan di komentar berkas bahwa 087 membalik keputusan 077.
- [ ] **Step 4: Jalankan** `run_all.sh`. Expected: gagal (`record_expense` masih dicabut: `permission denied` / `FAIL`).
- [ ] **Step 5: Tulis `087_cashier_expenses_back.sql`:** `grant execute on function public.record_expense(uuid, uuid, uuid, text, jsonb, text) to authenticated;` dan `create or replace function public.owner_add_expense_items(...)` dengan isi persis versi 073 (`git show d0fd8a1^:supabase/migrations/073_corrections.sql`, fungsi itu), lalu `revoke all ... from public, anon` dan `grant execute ... to authenticated`. Idempoten. Komentar di kepala berkas: 087 membalik 077 atas keputusan pemilik 23 Oktober 2026 dan data lama tidak diubah.
- [ ] **Step 6: Jalankan** `run_all.sh`. Expected: semua `PASS`, tanpa `ERROR`/`FAIL`, termasuk `test_041` sampai `test_077` dan `test_087`.
- [ ] **Step 7: Commit** `git add supabase && git commit -m "Cashier expenses are back: record_expense and drawer expenses for the owner (087)"`

---

### Task 2: POS — data, antrean offline, dan unit

**Files:**
- Restore: `apps/pos-mobile/src/utils/expense.ts`, `apps/pos-mobile/tests/expense_test.js`
- Modify: `src/types/domain.ts`, `src/services/transaction/repository.ts`, `src/services/transaction/offlineQueue.ts`, `src/services/local/shiftData.ts`, `src/utils/shiftReport.ts`, `package.json`, `tests/offline_queue_test.js`, `tests/shift_report_test.js`, `tests/shift_data_test.js`

**Interfaces:**
- Produces (TS), sama dengan kode sebelum `d0fd8a1`: `types/domain.ts` — `ExpenseCategory = 'operasional' | 'belanja'`, `ExpenseItem { name; category; quantity; unit; amount }`, `Expense { id; createdAt; total; drawerTotal; items: Array<ExpenseItem & { paidFrom: 'drawer' | 'other' }> }`, `ShiftRecord.expenses: number`. `utils/expense.ts` — `EXPENSE_UNITS`, `ExpenseLine`, `emptyLine(category?)`, `parseQuantity(s) -> number | null`, `parseAmount(s) -> number | null`, `checkLines(lines) -> { errors; items: ExpenseItem[] | null }`. `repository.ts` — `toExpense(d: any): Expense`, `recordExpense(args: { shiftId; cashierId; outletId; paidFrom: 'drawer' | 'other'; items: ExpenseItem[]; idempotencyKey: string }): Promise<Expense>`, `fetchShiftExpenses(shiftId): Promise<Expense[]>`, dan `fetchOutletShifts` memetakan `expenses`. `offlineQueue.ts` — `QueuedKind` memuat `'expense'`, `QueuedCheckout.expense?: { paidFrom; items: ExpenseItem[] }`, cabang `runSync` memanggil `recordExpense`. `shiftData.ts` — `ShiftData.expenses: Expense[]` dari `d.expenses`. `utils/shiftReport.ts` — `ShiftReportData.expense: Expense | null` dan baris PENGELUARAN di `reportText` dan `waText`.
- Consumes: RPC `record_expense`, `list_shift_expenses` (Task 1, tidak berubah), dan `pos_shift_snapshot` yang masih memuat `expenses`.

- [ ] **Step 1: Kembalikan tes lama (merah).** `git checkout d0fd8a1^ -- apps/pos-mobile/tests/expense_test.js`; terapkan balik (`--3way`) hunk `tests/shift_report_test.js` dan `tests/shift_data_test.js`; untuk `tests/offline_queue_test.js` terapkan balik dengan `--3way` dan selesaikan konflik di sekitar baris 285. Tambahkan ke `package.json` `test:js` panggilan `node tests/expense_test.js` (acuan: `git diff d0fd8a1^ d0fd8a1 -- apps/pos-mobile/package.json`).
- [ ] **Step 2: Tambah tes baru di `tests/offline_queue_test.js`** untuk Review Focus 5: antrean yang dimuat dari `AsyncStorage` tidak mengubah isi kunci `${QUEUE_KEY}:expense` dan tidak mengirim entri `expense` yang ada di sana; entri `expense` baru di antrean utama dikirim oleh `runSync` sekali dengan kunci idempotensinya (mock `recordExpense` dipanggil satu kali walau `runSync` dijalankan dua kali berturut-turut setelah sukses).
- [ ] **Step 3: Jalankan** `npm run test:js`. Expected: FAIL (modul `utils/expense` dan fungsi yang dipakai tes belum ada).
- [ ] **Step 4: Kembalikan implementasi.** `git checkout d0fd8a1^ -- apps/pos-mobile/src/utils/expense.ts`; terapkan balik (`git diff d0fd8a1^ d0fd8a1 -- <path> | git apply -R --3way`) untuk `types/domain.ts`, `repository.ts`, `offlineQueue.ts`, `shiftData.ts`, `utils/shiftReport.ts`. Di `offlineQueue.ts`, **buang** pemisahan entri `expense` ke `${QUEUE_KEY}:expense` yang ditambahkan 077 (antrean dimuat apa adanya) tetapi **jangan** memuat isi kunci `${QUEUE_KEY}:expense` ke antrean (Review Focus 5); beri komentar satu baris yang menjelaskan alasannya.
- [ ] **Step 5: Jalankan** `npm run test:js` dan `npx tsc --noEmit`. Expected: semua tes lulus; tsc masih menunjukkan galat di berkas UI yang belum dikembalikan (`ShiftScreen`, `ShiftReportScreen`, `overlays`), dan itu dikerjakan di Task 3. Bila tsc gagal di berkas Task 2 sendiri, perbaiki.
- [ ] **Step 6: Commit** `git add apps/pos-mobile && git commit -m "POS: expense data layer, offline queue, and report text are back"`

---

### Task 3: POS — layar Shift, laporan, dan terjemahan

**Files:**
- Restore: `apps/pos-mobile/src/screens/shift/ExpenseSheet.tsx`
- Modify: `src/screens/shift/ShiftScreen.tsx`, `src/screens/shift/ShiftReportScreen.tsx`, `src/components/overlays.tsx`, `src/screens/sell/SellScreen.tsx`, `src/i18n/en.ts`, `e2e/mock-supabase.mjs`, `README.md`

**Interfaces:**
- Consumes: semua dari Task 2 (`Expense`, `recordExpense`, `fetchShiftExpenses`, `ShiftData.expenses`, `ShiftReportData.expense`, `QueuedCheckout.expense`, `checkLines`).
- Produces: `ExpenseSheet({ visible: boolean; onClose: () => void; onSaved: () => void })` (komponen lama); layar Shift memuat tombol "Catat pengeluaran", kartu "Pengeluaran shift ini", dan label kas keluar "Kas keluar (refund, pengeluaran)".

- [ ] **Step 1: Tulis tes yang gagal.** Perluas `tests/shift_report_test.js` (sudah dikembalikan di Task 2) dengan dua assert yang menjaga teks laporan: `reportText` memuat `PENGELUARAN` dan total, dan menandai butir bukan laci dengan `(bukan laci)`; `waText` memuat daftar bernomor dan `(bukan dari laci)`. Bila sudah ada di tes lama, cukup pastikan merah sebelum Step 3.
- [ ] **Step 2: Jalankan** `npm run test:js` dan `npm run i18n:check`. Expected: `i18n:check` gagal (kunci terjemahan pengeluaran belum ada) dan/atau tes laporan gagal.
- [ ] **Step 3: Kembalikan UI.** `git checkout d0fd8a1^ -- apps/pos-mobile/src/screens/shift/ExpenseSheet.tsx`; terapkan balik hunk `ShiftScreen.tsx` (tombol, kartu, `queuedExpenses`, `pendingDrawerOut`, efek muat ulang saat antrean pengeluaran terkirim, cetak laporan memuat `fetchShiftExpenses`, label "Kas keluar (refund, pengeluaran)"), `ShiftReportScreen.tsx` (`Bundle.expense`, slip PENGELUARAN, catatan kas), `overlays.tsx` (`--3way`, selesaikan konflik di sekitar baris 83), `SellScreen.tsx` (komentar), `e2e/mock-supabase.mjs`, `README.md`, dan `src/i18n/en.ts` (`--3way`, selesaikan konflik di sekitar baris 193). Jangan menyentuh hunk di berkas-berkas itu yang bukan tentang pengeluaran.
- [ ] **Step 4: Jalankan** `npm run test:js`, `npx tsc --noEmit`, `npm run i18n:check`. Expected: semua lulus dan tsc bersih.
- [ ] **Step 5: Verifikasi di perangkat/web.** `npm run mock:supabase` dan `npm run web:mock` (atau uji manual di HP): buka shift, catat pengeluaran dari laci (uang seharusnya turun), catat bukan dari laci (tidak turun), matikan jaringan dan catat satu (tampil "belum terkirim" lalu terkirim setelah jaringan kembali, sekali), cetak/bagikan laporan shift (baris PENGELUARAN muncul). Catat hasil per langkah; bila tidak bisa dijalankan di lingkungan ini, katakan dan tandai sebagai belum diuji.
- [ ] **Step 6: Commit** `git add apps/pos-mobile && git commit -m "POS: Catat pengeluaran sheet, shift card, and report lines are back"`

---

### Task 4: BackOffice — pilihan "Uang dari" kembali

**Files:**
- Modify: `apps/web/apps/backoffice/src/lib/schemas.ts`, `src/server/expenses.ts`, `src/routes/_app/expenses.tsx`, `src/dict.ts`
- Test: `apps/web/apps/backoffice/tests/` (berkas baru `expenses.test.ts`)

**Interfaces:**
- Produces: `expenseAddSchema` memuat lagi `paidFrom: z.enum(['drawer', 'other'], { error: 'Pilih sumber uang.' })`; `addExpenseItems` meneruskan `p_paid_from: data.paidFrom`; dialog "Tambah barang ke shift" punya pilihan "Uang dari" (Bukan dari laci / Kas laci), bawaan `other`, dan deskripsi yang menjelaskan efek ke kas shift buka dan tutup (teks lama dari `git show d0fd8a1^:apps/web/apps/backoffice/src/routes/_app/expenses.tsx`).

- [ ] **Step 1: Tulis tes yang gagal** `tests/expenses.test.ts` (gaya `tests/stock.test.ts`): `expenseAddSchema` menerima `paidFrom` `'drawer'` dan `'other'` dengan satu butir sah; menolak `paidFrom` tanpa nilai dan `'lain'` dengan pesan `Pilih sumber uang.`; menolak 0 butir (`Isi minimal satu barang.`) dan 31 butir (`Maksimal 30 barang sekali simpan.`). Tambah tes kamus: setiap teks UI yang dikembalikan (`Uang dari`, `Kas laci`, `Bukan dari laci`, deskripsi dua keadaan shift) ada di `EN`.
- [ ] **Step 2: Jalankan** `npm test -w @hermes-pos/backoffice`. Expected: FAIL.
- [ ] **Step 3: Implementasi** dengan menerapkan balik hunk `expenses.tsx`, `schemas.ts` (hanya `paidFrom` di `expenseAddSchema`, bukan `dayLockSchema`), `server/expenses.ts`, dan baris kamus yang berkaitan di `dict.ts` (`git diff d0fd8a1^ d0fd8a1 -- <path> | git apply -R --3way`, lalu buang hunk tutup hari bila ikut).
- [ ] **Step 4: Jalankan** `npm test -w @hermes-pos/backoffice` dan `npm run typecheck -w @hermes-pos/backoffice`. Expected: lulus dan bersih. Pastikan halaman Shift (`closing.tsx`) tetap menampilkan baris "Pengeluaran dari laci" bila tidak nol (sudah begitu) dan `ReportDocument.tsx` tidak berubah.
- [ ] **Step 5: Verifikasi.** `npm run mock` dan `npm run dev:backoffice` dari `apps/web`, buka Pengeluaran, "Tambah barang": pilihan Uang dari tampil dan berfungsi. Bila tidak ada browser, katakan dan tandai belum diuji.
- [ ] **Step 6: Commit** `git add apps/web && git commit -m "Backoffice: choose drawer or not when adding expense items"`

---

### Task 5: Dokumen dan verifikasi akhir

**Files:** `README.md`, `docs/ACCOUNTING.md`, `docs/PRD.md`, `docs/DESIGN.md`, `apps/pos-mobile/README.md`

- [ ] **Step 1: Perbarui dokumen** yang masih menyatakan aplikasi kasir hanya penjualan atau pengeluaran bukan dari laci: `git diff d0fd8a1^ d0fd8a1 -- README.md docs apps/pos-mobile/README.md` menunjukkan kalimat yang diubah 077; kembalikan kalimat tentang pengeluaran (bukan tentang tutup hari), sebut migrasi 087 di daftar migrasi README (backoffice dan APK butuh 087; terapkan migrasi sebelum APK), dan catat bahwa uang masuk/keluar manual tetap hanya di BackOffice.
- [ ] **Step 2: Verifikasi penuh.** SQL `run_all.sh` (tanpa `ERROR`/`FAIL`); POS `npm run test:js`, `npx tsc --noEmit`, `npm run i18n:check`; BackOffice `npm test` dan `typecheck`; build `npm run build -w @hermes-pos/backoffice`.
- [ ] **Step 3: Commit** `git add -A README.md docs apps/pos-mobile/README.md && git commit -m "Docs: cashier expenses are back (087)"`
- [ ] **Step 4: Ringkas** untuk pemilik: migrasi 087 diterapkan dulu, lalu APK baru (rilis lewat tag `v*` dengan workflow `release-apk`, versi dinaikkan di `app.json` dan `build.gradle` oleh langkah rilis, bukan di rencana ini). Tidak ada push.
