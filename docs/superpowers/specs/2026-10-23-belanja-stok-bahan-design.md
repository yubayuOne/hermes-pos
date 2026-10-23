# Belanja bahan dan stok bahan (hermes-pos)

Tanggal: 2026-10-23. Proyek B; bergantung pada proyek A (`2026-10-23-pengeluaran-pos-kembali-design.md`) dan pada HPP dari resep (`2026-10-23-hpp-resep-design.md`, migrasi 084 sampai 086), yang sudah berjalan. Ini tahap 2 dan sebagian tahap 3 dari rencana HPP.

## Maksud

Harga bahan tidak satu angka: belanja rutin di pasar murah, belanja darurat di warung terdekat lebih mahal. Pemilik ingin (1) mencatat belanja seperti di bukunya, (2) tahu sisa tiap bahan tanpa menghitung manual, dan (3) HPP menu mengikuti harga **rata-rata dari stok yang ada**, bukan harga yang diketik. Contoh pemilik: susu kental manis (SKM) 2 pcs, total Rp36.000, Rp18.000 per pcs.

## Tujuan

- **Catatan belanja** (tab "Belanja" di menu Bahan & Resep): satu catatan = satu perjalanan belanja, berisi banyak bahan. Tiap baris: bahan, jumlah kemasan, total bayar; harga per kemasan dihitung otomatis dari total. Bahan yang belum ada bisa dibuat saat mengisi baris.
- **Tanggal belanja** dipilih pemilik (bawaan: hari ini), dicatat kapan saja, tidak terikat shift.
- **Dibayar dari:** dua pilihan. (1) *Bukan kas laci* (QRIS, rekening, uang pribadi): tidak menyentuh kas shift. (2) *Pengeluaran kasir yang sudah ada*: pemilik memilih butir pengeluaran laci kasir (proyek A) yang sudah mencatat uang keluar itu; sistem hanya menghubungkannya, **tidak memotong kas lagi**.
- **Stok bahan:** tiap bahan punya stok (satuan dasar g, ml, atau pcs). Belanja menambah stok. Setiap penjualan menu ber-resep mengurangi stok bahan sesuai resepnya.
- **Harga rata-rata bergerak** per bahan: saat belanja, `rata-rata baru = (stok lama positif × rata-rata lama + jumlah beli × harga beli per satuan dasar) ÷ (stok lama positif + jumlah beli)`. Bila stok lama ≤ 0, rata-rata baru = harga beli. Penjualan **tidak** mengubah rata-rata.
- **HPP menu ber-resep mengikuti rata-rata** otomatis (`recompute_hpp` untuk semua menu yang memakai bahan itu) setiap belanja.
- **Hitung stok bahan** (opname) memakai alur dokumen seperti stok produk: selisih fisik dan sistem dicatat; ada juga jenis penyesuaian (rusak, tumpah, dipakai sendiri) dengan alasan.
- Tab Bahan menampilkan stok dan harga rata-rata; bahan di bawah batas yang diisi pemilik diberi tanda "tinggal sedikit".
- Riwayat belanja dan dokumen stok bahan bisa dibuka. **Belanja dibatalkan dengan alasan** (aturan di bawah); dokumen stok (awal, hitung, penyesuaian) tidak dibatalkan, tetapi dikoreksi dengan dokumen baru, sama seperti dokumen stok produk. Tidak ada yang diubah diam-diam.

## Bukan tujuan

- Laporan pemakaian teoritis lawan nyata, peringatan food cost, dan notifikasi bel untuk stok bahan menipis (kelanjutan nanti).
- Rendemen dan susut per bahan, satuan selain g, kg, ml, l, pcs, varian menu.
- Belanja dari POS oleh kasir (pengeluaran kasir di proyek A sudah mencatat uangnya).
- Memasukkan belanja bahan ke laba rugi: tetap **informasi**; biayanya terwakili HPP menu yang terjual. Selisih stok (opname dan penyesuaian) tetap masuk **Penyesuaian stok** seperti stok produk.
- Mengubah stok produk jadi, tutup hari, atau aturan kas shift.

## Anti-tujuan

- Uang yang sama terhitung dua kali (kas laci terpotong lagi karena belanja yang sudah dicatat kasir).
- HPP berubah tanpa jejak: setiap perubahan harga rata-rata punya sumber (belanja, atau koreksi) yang bisa ditelusuri.
- Penjualan terhambat karena stok bahan habis atau salah catat.
- Pemilik harus mengisi stok awal semua bahan sebelum bisa memakai fitur.

## Keputusan pemilik

1. HPP memakai **rata-rata dari stok yang ada**.
2. Belanja tidak terikat shift; tanggal belanja dipilih pemilik.
3. Belanja dari uang laci selalu dicatat kasir di POS sebagai pengeluaran (proyek A); pemilik menghubungkannya, bukan mencatat ulang.
4. Format baris belanja: nama, jumlah, satuan, total bayar, harga per satuan.
5. Fitur pengeluaran kembali di POS (proyek A) lebih dulu.

## Perilaku

### Bahan dan kemasan
Bahan sudah punya harga kemasan, isi kemasan, dan satuan (084). Jumlah belanja dihitung dalam **kemasan**; stok disimpan dalam satuan dasar: `kemasan × isi kemasan × faktor satuan`. Contoh: SKM kemasan 370 g, beli 2 kemasan → stok bertambah 740 g.

### Harga bahan yang diketik
Sebelum ada belanja pertama, harga di formulir Bahan adalah harga acuan dan menjadi rata-rata awal. Sesudah bahan punya belanja, harga yang ditampilkan adalah rata-rata dan tidak bisa diketik langsung (perubahan lewat belanja atau koreksi); bahan tanpa belanja tetap bisa diubah seperti sekarang, dan pratinjau "menu yang ikut berubah" tetap berlaku.

### Stok negatif
Penjualan tidak pernah ditolak karena stok bahan. Stok boleh menjadi negatif (belanja belum dicatat); tampil merah. Belanja berikutnya memakai aturan stok lama ≤ 0.

### Penjualan, void, koreksi
Menu dengan `hpp_source = 'recipe'` yang terjual mengurangi stok tiap bahan resepnya saat pembayaran (jumlah resep × jumlah terjual, dikonversi ke satuan dasar). **Bahan yang terpakai tidak pernah kembali lewat penjualan** (keputusan pemilik, 23 Oktober 2026): minuman yang sudah dibuat tidak bisa menjadi bahan lagi. Jadi void bill, refund, dan koreksi yang menghapus butir **tidak** mengembalikan bahan. Koreksi yang **menambah** butir atau menaikkan jumlah mengurangi bahan sebesar tambahannya; koreksi yang mengurangi tidak mengembalikan. Salah catat diluruskan dengan Hitung stok. Menu manual (tanpa resep) tidak mengurangi bahan.

### Pembatalan belanja
Belanja dibatalkan dengan alasan (3 sampai 200 karakter). Syarat: untuk setiap bahan di dalamnya, belanja itu adalah pergerakan harga terakhirnya (tidak ada belanja yang lebih baru untuk bahan itu). Bila tidak, ditolak dengan pesan "Sudah ada belanja setelahnya; batalkan yang terbaru dulu." Pembatalan mengurangi stok dan memulihkan rata-rata sebelumnya, lalu menghitung ulang HPP menu. Hubungan ke butir pengeluaran dilepas.

### Hitung stok dan penyesuaian
Dokumen stok bahan punya jenis: awal, hitung (opname), penyesuaian. Menghitung bahan yang belum punya pergerakan apa pun = **stok awal** (bukan selisih, tidak masuk laba rugi). Selisih opname dan penyesuaian bernilai `selisih × rata-rata` dan masuk **Penyesuaian stok** (buku besar dan laba rugi) sama seperti stok produk; periksa 074 dan 075 dan perluas cek P7 agar mencakup bahan: hitungan terakhir ditambah pergerakan sesudahnya sama dengan stok sekarang.

### Batas
Satu catatan belanja maksimal 50 baris; jumlah kemasan di atas 0, sampai 3 desimal, di bawah 1.000.000; total bayar 0 sampai 1.000.000.000; tanggal belanja tidak di masa depan dan paling lama 90 hari ke belakang; satu bahan sekali per catatan. Satu butir pengeluaran hanya bisa dihubungkan ke satu belanja; bila totalnya berbeda dari total belanja, tampilkan peringatan (tidak memblokir).

### Hak akses dan langganan
Hanya pemilik (seperti dokumen stok). Langganan berakhir mengunci tulis seperti fitur lain.

## Pilihan pembangun (hasil tinjauan, bukan keputusan pemilik)

1. **Hitung pertama setelah ada penjualan.** Hitung stok pada bahan yang belum pernah punya belanja atau stok awal diperlakukan sebagai **stok awal** (mengganti saldo, termasuk saldo negatif akibat penjualan sebelumnya), bukan selisih, jadi tidak ada kerugian palsu di Penyesuaian stok. Anti-tujuan "tidak perlu stok awal sebelum memakai fitur" tetap berlaku.
2. **Butir pengeluaran yang dihubungkan.** Hanya butir `paid_from = 'drawer'` dengan kategori `belanja` yang bisa dihubungkan. `owner_cancel_expense_item` menolak membatalkan butir yang terhubung ke belanja ("Dipakai di catatan belanja. Batalkan belanjanya dulu."). Membatalkan belanja melepas tautan.
3. **Buku besar dan laba rugi.** Belanja yang dibayar "bukan kas laci" tidak menulis baris buku besar; yang dari laci sudah tercatat oleh pengeluaran kasir (proyek A). Nilai persediaan bahan tidak menjadi akun aset (informasi, seperti "Pembelian bahan" di ACCOUNTING 3.1). Stok awal tidak menulis baris. Hanya selisih opname dan penyesuaian yang memakai mekanisme dan akun **Penyesuaian stok** yang sama dengan stok produk (074, 075); pembangun memeriksa bahwa P5 tetap seimbang dan P7 mencakup bahan.
4. **Ubah isi kemasan atau satuan setelah ada pergerakan.** Stok dan rata-rata disimpan dalam satuan dasar, jadi mengubah isi kemasan atau satuan (dalam jenis yang sama) hanya mengubah cara belanja berikutnya dan harga kemasan yang ditampilkan; stok dan rata-rata per satuan dasar tidak berubah. Bahan yang punya pergerakan stok tidak bisa dihapus (sudah tidak bisa bila dipakai resep).
5. **Void dan refund tidak mengembalikan bahan** (keputusan pemilik). Karena itu tidak perlu menyimpan konsumsi per butir transaksi; koreksi bill hanya menambah konsumsi untuk tambahan butir atau jumlah, dihitung dari resep saat koreksi.
6. **Dokumen stok bahan tidak dibatalkan,** dikoreksi dengan dokumen baru (mengikuti stok produk).
7. **Nilai penyesuaian.** Setiap bahan selalu punya harga rata-rata: harga acuan sebelum belanja pertama, lalu hasil rumus. Saat stok ≤ 0, rata-rata terakhir tetap dipakai untuk menilai selisih.
8. **Offline.** Checkout yang dikirim terlambat mengurangi stok bahan saat tersinkron, sama seperti stok produk sekarang.

## Tampilan

Mockup: `.superpowers/brainstorm/65665-1792758405/content/belanja-stok.html` (tidak di-commit).
- Menu "Bahan & Resep" punya tiga tab: Bahan, Resep, Belanja.
- Tab Belanja: daftar catatan (tanggal, ringkasan bahan, total, dibayar dari) dan tombol "Catat belanja". Formulir: tanggal, tabel baris (bahan dengan keterangan isi kemasan, jumlah kemasan, total bayar, harga per kemasan otomatis), tombol "Tambah bahan", total belanja, pilihan "Dibayar dari", Simpan.
- Tab Bahan: kolom stok dan harga rata-rata, tanda "tinggal sedikit", tombol "Hitung stok" dan "Riwayat"; isian "Batas stok menipis" (opsional) di formulir bahan.
- Teks: istilah HPP dan satuan seperti keputusan HPP (g, kg, ml, l, pcs); istilah "kemasan" untuk jumlah belanja. Dua bahasa.

## Data (saran, boleh disesuaikan)

Migrasi baru (nomor sesudah proyek A). Pergerakan stok bahan dicatat dalam satu log per bahan (jenis: belanja, jual, awal, hitung, penyesuaian; jumlah bertanda dalam satuan dasar; harga rata-rata sebelum dan sesudah untuk belanja) agar pembatalan dan cek P7 bisa dibuktikan. Tabel catatan belanja dan barisnya (jumlah kemasan, total, tanggal belanja, `paid_from`, tautan opsional ke butir pengeluaran, dibatalkan beserta alasan). Stok dan rata-rata bergerak menjadi bagian bahan; `recipe_cost` memakai rata-rata sehingga bentuk jawabannya tidak berubah. Semua fungsi `security definer`, RLS aktif, `revoke all`, urutan kunci bahan lalu produk seperti 086.

## Yang diserahkan ke pembangun

- Bentuk tabel, nama fungsi, dan cara menyimpan rata-rata (kolom baru atau menurunkan dari log) selama presisi minimal 0,01 rupiah per kemasan dan `recipe_cost` tetap satu sumber.
- Titik pemotongan stok bahan di `complete_checkout` dan fungsi koreksi bill (073), dengan kunci bahan lebih dulu (urutan id) lalu produk, dan tanpa memperlambat checkout secara berarti (maksimal 40 bahan per menu).
- Cara paling aman memperluas Penyesuaian stok dan P7 tanpa merusak cek yang ada.
- Aturan "tinggal sedikit" yang tepat (di bawah atau sama dengan batas) dan tampilan kosong, memuat, serta galat.

## Pengujian

- SQL: rata-rata bergerak (contoh pemilik: 2 liter @18.000 + 1 liter @22.000 → rata-rata 19.333,33 per liter, HPP es kopi susu ikut), stok lama ≤ 0, penjualan mengurangi bahan dan tidak mengubah rata-rata, konversi satuan (kemasan ke satuan dasar), void bill dan refund tidak mengembalikan bahan, koreksi yang menambah butir mengurangi bahan sebesar tambahannya dan koreksi yang mengurangi tidak mengembalikan, pembatalan belanja terbaru memulihkan rata-rata dan stok, pembatalan belanja yang bukan terbaru ditolak, tautan ke butir pengeluaran tidak memotong kas (kas shift tidak berubah), butir yang sama tidak bisa dihubungkan dua kali, stok awal bukan selisih, opname dan penyesuaian masuk Penyesuaian stok, P7 bersih, isolasi antar bisnis, bahan di outlet lain ditolak, urutan kunci tidak deadlock pada penjualan paralel dengan belanja (uji dua sesi bila bisa).
- TS: skema belanja (batas, desimal, dobel, tanggal), kamus dua bahasa, pemeriksaan tipe.
- Manual: belanja rutin, belanja darurat dengan harga lebih mahal, lihat HPP menu naik sedikit, jual beberapa gelas, lihat stok turun, hitung stok.
