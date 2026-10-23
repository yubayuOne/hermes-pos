# Tautan pengeluaran ke belanja bahan (hermes-pos)

Tanggal: 2026-10-23. Pilihan pemilik: pencocokan dilakukan di BackOffice, POS tidak berubah. Migrasi 089. Melengkapi `2026-10-23-belanja-stok-bahan-design.md` (rilis B1) dan `2026-10-23-pengeluaran-pos-kembali-design.md`.

## Maksud

Satu belanja dari laci tercatat sekali. Kasir mencatat uang keluar di POS (uang laci berkurang). Pemilik menandai barang yang masuk stok di BackOffice. Stok, harga rata-rata, dan HPP ikut berubah, tanpa mengetik ulang jumlah atau harga. Barang non-stok (listrik, gas, plastik) tetap hanya pengeluaran.

## Tujuan

- Di Pengeluaran, setiap catatan dengan barang kategori **belanja** punya aksi "Masuk stok": per barang pilih bahan dan jumlah kemasan. Total diambil dari jumlah barang pengeluaran, tidak diketik ulang.
- Satu aksi membuat **satu catatan belanja** untuk semua barang yang dipilih dari hari yang sama, dengan tanggal belanja = tanggal bisnis shift.
- Barang yang sudah masuk stok memperlihatkan tandanya dan dari belanja mana.
- Belanja omset (QRIS, di luar laci) tetap dicatat langsung di tab Belanja, tanpa tautan.

## Bukan tujuan

- Mengubah POS dan aplikasi kasir.
- Mengubah uang laci, cek P5, atau aturan kas shift. Menautkan barang **tidak mengubah kas** sama sekali: uang sudah dihitung dari pengeluaran.
- Menautkan barang kategori operasional, atau barang yang sudah dibatalkan.

## Aturan

1. **Hanya kategori belanja** yang bisa masuk stok. Operasional tidak.
2. **Satu barang hanya bisa masuk stok sekali** selama belanjanya aktif. Barang yang belanjanya dibatalkan boleh dimasukkan lagi.
3. **Total = jumlah barang**, bukan angka ketikan. Karena itu tidak mungkin salah.
4. **Satu aksi = satu hari bisnis.** Barang dari hari berbeda harus dipisah.
5. **Barang yang sudah masuk stok tidak bisa dibatalkan** sebelum belanjanya dibatalkan. Pesan: "Barang ini sudah masuk stok. Batalkan belanjanya dulu."
6. **Membatalkan belanja** melepas tautannya; barang bisa dimasukkan lagi.
7. Aturan harga rata-rata, stok awal, dan batas (90 hari, dll.) tetap dari B1; tautan memakai jalur yang sama.

## Pilihan pembangun (bukan keputusan pemilik)

- Barang yang sudah dibatalkan dari pengeluaran sudah terhapus dari tabel barang, jadi tidak ada lagi. Tautan dicek lewat keberadaan barang.
- Tautan disimpan di baris belanja (`purchase_lines.expense_item_id`), tanpa kolom di tabel pengeluaran, supaya tabel pengeluaran (073) tidak diubah.
- Pencegahan pembatalan barang dipasang sebagai pemicu pada tabel barang pengeluaran, bukan dengan menyunting fungsi pembatalan 073.
- Pembatalan belanja tidak diubah: tautannya tetap tercatat tetapi hanya dihitung untuk belanja yang aktif.

## Pengujian

- Menautkan barang: stok, harga rata-rata, dan HPP berubah; kas shift tidak berubah.
- Tautan kedua ditolak; barang operasional ditolak; barang dari hari berbeda ditolak; barang milik bisnis lain ditolak.
- Membatalkan barang yang sudah masuk stok ditolak dengan pesan; setelah belanjanya dibatalkan, barang bisa dibatalkan dan dimasukkan lagi.
- Barang paid_from `other` juga bisa masuk stok, dan kasnya tetap tidak berubah.
- Belanja omset (tanpa tautan) tetap bekerja.
