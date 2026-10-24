# Manajemen meja (hermes-pos)

Tanggal: 2026-10-24. Dibangun di atas bill yang ditahan (held bill) dan kolom meja yang sudah ada di transaksi (`table_number`, teks bebas).

## Maksud

Kasir tidak bisa melihat meja mana yang sedang terisi. Nomor meja diketik bebas per bill. Fitur ini membuat daftar meja yang dikelola pemilik, dan kasir memilih meja dari daftar itu.

## Tujuan (v1)

- Pemilik membuat daftar meja per outlet (nomor atau nama, aktif/nonaktif), sekali saja.
- Kasir memilih meja untuk bill makan di tempat dari kotak besar. Meja kosong langsung dipakai; meja terisi membuka bill-nya.
- Bill bawa pulang tidak memakai meja.
- Pindah meja: bill yang sedang berjalan bisa dipindah ke meja kosong.

## Bukan tujuan (v1)

- Gabung meja, area atau lantai, reservasi, timer lama duduk.
- Status meja yang disimpan terpisah.

## Keputusan

1. **Meja wajib untuk makan di tempat.** Bill makan di tempat tanpa meja tidak bisa disimpan.
2. **Status terisi diturunkan dari bill yang ditahan di meja itu.** Tidak ada kolom status yang bisa tidak sinkron.
3. **Meja dipakai di HP lain** tampil sebagai terisi begitu sinkron, dengan tanda "di HP lain". Saat offline, pemakaian tidak diblokir, dan bisa terjadi dua kasir memakai meja yang sama sampai sinkron.
4. **Tutup shift saat ada meja terisi tetap diblokir** oleh aturan bill ditahan yang sudah ada ("N bill masih ditahan. Bayar atau hapus dulu."). Peringatan saja tidak dipakai, karena bill ditahan di meja itu memang harus diselesaikan dulu.
5. **Bill ditahan wajib punya meja** (trigger pada `transactions`, sehingga semua jalur ikut, termasuk ubah bill). Bill yang sudah ada tanpa meja hanya diperiksa saat mejanya diganti.

## Perilaku

- BackOffice: halaman Meja (nomor atau nama, aktif, tambah, ubah, nonaktifkan). Nonaktifkan tidak boleh untuk meja yang masih punya bill ditahan.
- Kasir: saat membuka bill makan di tempat, muncul kotak meja (kosong / terisi + jam mulai). Pindah meja dari menu bill.
- Yang belum ada di v1: membuka bill dari meja terisi langsung. Meja terisi tidak bisa dipilih; bill-nya dibuka dari tab Bill.
- Teks bill tetap menampilkan nomor meja, sehingga laporan dan struk tidak berubah.
- Bill lama dengan nomor meja teks bebas tetap tampil apa adanya.

## Data (saran)

- Tabel `tables` (outlet, nomor/nama unik per outlet, aktif, dibuat).
- Tidak ada kolom `table_id`. Bill tetap menyimpan nama meja di `table_number` (teks, seperti sebelum 091), sehingga struk, laporan, dan bill lama tampil sama. Status terisi dicari dari nama itu.
- Migrasi 091 untuk tabel `tables`, fungsi, dan trigger, dengan RLS dan grant mengikuti pola 088.

## Pengujian

- Meja tidak bisa dinonaktifkan selama ada bill ditahan di meja itu.
- Makan di tempat tanpa meja ditolak; bawa pulang diterima.
- Pindah meja memindahkan bill dan mengosongkan meja asal.
- Meja terisi terlihat dari HP lain setelah sinkron.
- Dua bill baru bisa jatuh di meja kosong yang sama saat offline atau bersamaan; server tidak menolak. Ini diterima di v1 (keputusan 3).
- Tutup shift dengan bill ditahan tetap diblokir (aturan lama, keputusan 4).
- Isolasi antar bisnis dan outlet.
