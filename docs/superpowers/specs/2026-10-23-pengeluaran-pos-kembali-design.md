# Pengeluaran kembali di aplikasi POS (hermes-pos)

Tanggal: 2026-10-23. Proyek A dari dua; proyek B (belanja bahan dan stok bahan, `2026-10-23-belanja-stok-bahan-design.md`) bergantung pada ini dan dikerjakan sesudahnya.

## Maksud

Pada 21 Oktober 2026 pemilik memutuskan aplikasi kasir hanya untuk penjualan: pengeluaran dicatat pemilik di BackOffice dan tidak pernah keluar dari laci (migrasi 077). Pada 23 Oktober 2026 pemilik membalik keputusan itu. Alasan: di warung, **kasir membeli bahan darurat memakai uang laci** saat shift berjalan, dan uang itu harus tercermin di hitungan uang kasir saat tutup shift. Tanpa pencatatan di POS, laci tampak kurang dan kasir menutupinya dengan catatan lisan.

## Tujuan

- Kasir mencatat pengeluaran di POS: satu catatan berisi banyak barang (nama, jumlah, satuan, total bayar, kategori `operasional` atau `belanja`), dengan sumber uang **kas laci** atau **bukan dari laci**.
- **Uang laci yang seharusnya** = modal awal + penjualan tunai + kas masuk laci − refund tunai − kas keluar manual − **pengeluaran dari laci**. Pengeluaran bukan dari laci tidak mengubah kas.
- Pengeluaran tampil di halaman Shift (kartu "Pengeluaran shift ini"), di laporan shift (cetak termal dan teks WhatsApp), dan di BackOffice (halaman Pengeluaran, halaman Shift).
- Pemilik di BackOffice kembali bisa memilih "Kas laci / Bukan dari laci" saat mencatat pengeluaran.
- Pengeluaran yang dibuat saat HP offline antre dan terkirim nanti, seperti sebelum 077.

## Bukan tujuan

- Menghidupkan lagi tutup hari (dicabut di 078 dan tetap dicabut).
- Mengubah uang masuk/keluar laci manual milik pemilik di BackOffice (`owner_add_cash_movement`): tetap ada untuk uang laci yang berpindah bukan karena belanja (mis. setor). Aplikasi POS tidak punya lembar kas manual dan tidak ditambah satu.
- Menghubungkan pengeluaran ke bahan atau stok bahan (itu proyek B).
- Mengubah data pengeluaran yang sudah ada. Baris buku kas lama tidak disentuh.
- Alur persetujuan pengeluaran yang tidak ada sebelum 077 (kembali persis seperti perilaku sebelum 077).

## Anti-tujuan

- Uang yang sama terpotong dua kali (mis. pengeluaran kasir di POS dan lagi oleh pemilik di BackOffice).
- Cek keseimbangan buku kas (P5, `ledger_checks`) menjadi tidak bersih.
- HP kasir dengan APK lama rusak setelah migrasi diterapkan.

## Keputusan pemilik

1. Pengeluaran kembali di POS, seperti sebelum 077.
2. Sumber uang: kas laci atau bukan dari laci. Kasir memilihnya saat mencatat.
3. Kas masuk/keluar manual pemilik di BackOffice dipertahankan.
4. Tutup hari tetap dihilangkan.

## Perilaku

Semua perilaku POS, BackOffice, dan SQL kembali seperti sebelum commit `d0fd8a1` ("Cashier app for sales only, no day close (077, 078)"), kecuali bagian tutup hari. Pembangun memakai `git show d0fd8a1^:<path>` dan `git show d0fd8a1 -- <path>` sebagai acuan kode sebelumnya, dan **mengembalikan hanya bagian pengeluaran**, tidak men-*revert* seluruh commit.

Berkas yang disentuh commit itu untuk pengeluaran (acuan, bukan daftar paksaan): di `apps/pos-mobile`: `src/screens/shift/ExpenseSheet.tsx`, `ShiftScreen.tsx`, `ShiftReportScreen.tsx`, `src/utils/expense.ts`, `src/utils/shiftReport.ts`, `src/services/transaction/repository.ts` dan `offlineQueue.ts`, `src/services/local/shiftData.ts`, `src/types/domain.ts`, `src/components/overlays.tsx`, `tests/expense_test.js`, `e2e/mock-supabase.mjs`; di `apps/web/apps/backoffice`: `routes/_app/expenses.tsx`, `routes/_app/closing.tsx`, `components/ReportDocument.tsx`, `lib/schemas.ts`, `server/closing.ts`, `server/expenses.ts`, `dict.ts`, `tests/closing.test.ts`; di `supabase`: migrasi `077_cashier_without_expenses.sql` dan `tests/test_077.sql`.

### Database (migrasi baru `087_…`; jangan mengubah 077)

- `grant execute` kembali pada `public.record_expense(uuid, uuid, uuid, text, jsonb, text)` untuk `authenticated`.
- `owner_add_expense_items` menerima `p_paid_from` `'drawer'` dan `'other'` lagi (versi 073).
- Pembatalan butir pengeluaran laci yang sudah ada tetap membalik baris buku kas (`owner_cancel_expense_item`, tidak berubah).
- Menutup shift menghitung uang seharusnya dengan memasukkan baris buku kas pengeluaran laci. Periksa `close_shift_at`, `shift_cash_expected` (atau fungsi setara) dan semua pembaca saldo laci di 073 sampai 078 agar tidak ada yang masih mengabaikan pengeluaran laci.
- Idempoten dan bisa diulang. Urutan rilis: **migrasi dulu, baru APK**. APK lama tidak memanggil `record_expense`, jadi tidak rusak.

### POS

- Tombol "Catat pengeluaran" di halaman Shift membuka lembar input (ExpenseSheet) seperti dulu; kartu "Pengeluaran shift ini"; hitungan "kas keluar" di halaman Shift memuat pengeluaran laci yang belum terkirim (`pendingDrawerOut`).
- Laporan shift (cetak dan WhatsApp) memuat baris PENGELUARAN lagi.
- Antrean offline memuat jenis `expense` lagi; item `expense` yang sudah dibuang saat 077 tidak perlu dipulihkan.

### BackOffice

- Halaman Pengeluaran: pilihan "Uang dari" dan kolom "Uang dari" kembali; teks batal yang menyebut buku laci kembali.
- Halaman Shift dan dokumen laporan: baris "Pengeluaran dari laci" tampil lagi; angka lama tetap benar.

## Yang diserahkan ke pembangun

- Cara paling aman mengembalikan potongan kode (menerapkan balik hunk yang relevan atau menulis ulang dengan acuan lama), asal perilaku di atas terpenuhi.
- Perubahan setelah `d0fd8a1` yang harus tetap dihormati: migrasi 078, 079 (`Audit follow-ups: expense shift fallback`), dan perubahan POS sesudahnya. Jangan membalik perbaikan itu.
- Penomoran versi aplikasi dan jalur rilis APK (workflow `release-apk` sudah ada, tag `v*`).
- Teks UI baru atau yang kembali: ikuti dua bahasa (`dict.ts` BackOffice dan `i18n` POS).

## Pilihan pembangun (hasil tinjauan, bukan keputusan pemilik)

0. **Isian lembar pengeluaran.** Pertahankan isian lembar lama yang sudah ringan: jumlah bawaan 1, satuan bawaan pcs, kategori bawaan belanja, sumber uang bawaan kas laci; hanya nama dan total yang wajib diketik. Tidak ada kalimat tambahan tentang "Kas keluar", karena POS tidak punya lembar itu.
1. **Siapa dan shift mana:** kembali ke perilaku sebelum 077 (kasir pemilik shift yang sedang buka mencatat; pemilik di BackOffice boleh menambah ke shift buka maupun tutup lewat `owner_add_expense_items`).
2. **Halaman Shift BackOffice:** `closing.tsx` dan `server/closing.ts` sudah diubah 078 menjadi halaman Shift. Hanya baris "Pengeluaran dari laci" dan angka terkait yang dikembalikan; halaman hasil 078 dipertahankan.

## Pengujian

- SQL: kasir memanggil `record_expense` (laci) dan uang seharusnya saat tutup shift berkurang sebesar itu; pengeluaran `other` tidak mengubah kas; pemilik menambah lewat `owner_add_expense_items` dengan `drawer` dan `other`; membatalkan butir laci membalik baris kas; `ledger_checks` bersih; cek P5 tetap hijau; suite lama (termasuk 041, 042, 043, 045, 072, 073, 077) disesuaikan seperlunya dan lulus. `test_077.sql` yang menegaskan penolakan `record_expense` diganti sesuai keputusan baru.
- TS/JS: tes POS (`expense_test`, `shift_report_test`, `offline_queue_test`) dan tes BackOffice (`closing.test.ts`, skema) lulus; pemeriksaan tipe bersih di kedua aplikasi.
- Manual di HP: buka shift, jual tunai, catat pengeluaran dari laci, tutup shift; uang seharusnya = modal + penjualan tunai − pengeluaran laci. Ulangi dengan HP offline.
