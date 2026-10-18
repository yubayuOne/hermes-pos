# PATCH V31 — Shift Close & Bill Print UX

## Perubahan

1. Menu Shift menjadi pusat laporan dan operasional shift.
2. Header halaman Shift tidak lagi menampilkan tombol Back; hardware Android Back tetap ditangani oleh App.
3. Tombol sticky bawah:
   - Tutup Shift ketika shift aktif
   - Buka Shift ketika belum ada shift aktif
   - Cetak Laporan
4. Popup Tutup Shift menampilkan:
   - Omset Cash
   - Petty Cash
   - Total Pengeluaran
   - Expected Cash
   - Input Cash Aktual / uang fisik untuk rekonsiliasi
5. Detail Bill pada Bill Selesai dan Bill Ditahan memiliki opsi cetak:
   - Bill Pelanggan
   - Bill Kitchen
   - Bill Bar
   - Seluruhnya
6. Tombol Panggil Bill tetap hanya tersedia untuk Bill Ditahan dan berada di popup detail.

## Catatan

Database/RPC `close_shift` tetap menggunakan nominal uang fisik sebagai nilai closing cash. Expected Cash dihitung dari ledger shift dan ditampilkan sebagai nilai referensi rekonsiliasi.
