# PATCH V31 — Optimasi jalur baca (request & payload)

Tujuan: mengurangi jumlah request dan ukuran data per kasir tanpa mengubah alur bisnis
(checkout, hold, split, shift, kas tidak diubah logikanya).

## Urutan rilis (penting)
1. Jalankan `supabase/migrations/017_read_path_optimization.sql` **lebih dulu** (`npm run db:push`
   atau SQL Editor). Migrasi bersifat additive: aplikasi versi lama tetap berjalan normal.
2. Baru build/rilis aplikasi versi ini. Aplikasi baru memanggil RPC dari migrasi 017.

## Perubahan
| Area | Sebelum | Sesudah |
|---|---|---|
| Dashboard | Unduh semua transaksi shift + item (~620 B/transaksi), hitung di HP | 1 RPC `get_shift_dashboard`, ~1,9 KB |
| Recall bill | 3 request (recall + 2 query item) | 1 RPC `recall_held_bill_with_items` |
| Sisa item split | 2 query + gabung di klien | 1 RPC `get_held_bill_items` |
| Katalog | 2 request tiap masuk layar Kasir | Cache memori 2 menit; layar tampil seketika dari cache perangkat |
| Daftar transaksi / kas / shift | Fetch ulang tiap pindah menu | Cache memori 60 dtk, di-invalidasi oleh aksi dari terminal ini |
| Index | — | `transactions(parent_transaction_id)` untuk pencarian child split |

File baru: `src/services/cache/memo.ts`, `supabase/migrations/017_read_path_optimization.sql`.
File diubah: `App.tsx`, `repository.ts`, `heldBills.ts`, `splitBills.ts`, `admin.ts`, `session.ts`,
`DashboardScreen.tsx`, `CashierScreen.tsx`, `HeldBillsSheet.tsx`.

## Perilaku yang berubah (sadari sebelum rilis)
- **Stok di layar Kasir bisa tertinggal hingga 2 menit** untuk penjualan dari terminal lain di outlet
  yang sama. Server tetap memvalidasi stok saat pembayaran, jadi tidak ada risiko oversell.
  Penjualan dari terminal ini sendiri langsung menginvalidasi katalog.
- **Dashboard/Pesanan/Shift bisa tertinggal hingga 60 dtk** hanya bila data shift diubah dari luar
  terminal ini (mis. void dari aplikasi Owner). Dashboard punya tarik-untuk-segarkan yang memaksa
  fetch baru; layar Pesanan belum punya tombol refresh.
- Sisa item split/recall kini digabung **per produk** dan diurutkan **menurut nama** (sebelumnya per baris,
  urutan tidak tentu). Hasil angka sama; hanya lebih konsisten bila ada baris produk ganda historis.
- Cache memori dibersihkan saat logout dan hilang saat aplikasi ditutup (bukan penyimpanan offline).

## Pengujian yang dijalankan
- Seluruh migrasi 001–017 diterapkan di PostgreSQL lokal.
- `supabase/tests/test_017.py`: hasil RPC dibandingkan dengan port logika lama klien (omzet, tunai/QRIS,
  per jam WIB, top 5 per station, sisa item split) + otorisasi (kasir lain, tanpa login, anon ditolak) +
  shift kosong.
- `supabase/tests/memo_test.js`: TTL, dedupe, invalidasi prefix, invalidasi saat request berjalan,
  error tidak di-cache.
- `tsc --noEmit`: tidak ada error baru (3 error lama di `ToastProvider.tsx` sudah ada sebelumnya).
- **Belum diuji:** aplikasi di perangkat/emulator dan terhadap project Supabase asli. Lakukan uji
  manual alur: login → buka shift → jual → hold → recall → split → dashboard → tutup shift.

Menjalankan ulang uji SQL: `pip install pgserver psycopg2-binary` lalu
`python supabase/tests/setup_db.py && python supabase/tests/test_017.py`.
