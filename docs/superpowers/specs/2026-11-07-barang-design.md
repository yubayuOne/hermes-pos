# Barang: stok, pengeluaran, dan stock opname (hermes-pos)

Tanggal: 2026-11-07. Menggantikan `2026-10-23-belanja-stok-bahan-design.md` dan `2026-10-23-tautan-pengeluaran-belanja-design.md`. Fitur Belanja dihapus; migrasi 084 sampai 089 tetap berlaku sebagai riwayat. Pengeluaran dari uang laci (proyek A, `2026-10-23-pengeluaran-pos-kembali-design.md`, migrasi 087) tetap mengurangi kas shift; lihat "Keputusan pemilik".

## Maksud

Pemilik mencatat semua yang dibeli, dari bahan makan sampai listrik dan iuran sampah, di satu tempat: **Barang**. Barang tertentu dihitung stoknya (minyak, gula, susu), barang lain tidak (listrik, iuran). Stok, harga rata-rata, dan HPP mengikuti pengeluaran yang dicatat, tanpa mengetik dua kali.

Dua hal dari pengalaman pemilik:
- Minyak 1 L yang ditimbang tanpa kemasan sering lebih dari 1 L. Jumlah stok karena itu **diisi nyata** saat masuk stok, bukan dihitung dari kemasan.
- Satuan dipilih sekali saat barang dibuat. Tidak ada konversi di belakang.

## Tujuan

- **Menu Barang:** daftar semua barang, dengan kategori, satuan, dan penanda **dihitung stok** (ya atau tidak). Satuan wajib diisi saat membuat barang dan tidak bisa diubah setelah barang punya stok.
- **Menu Resep:** terpisah dari Barang. Resep menu memakai barang yang dihitung stok, dengan jumlah dalam satuan barang.
- **Pengeluaran (BackOffice):** tiap baris punya barang (opsional), kategori, dan total bayar. Kalau barangnya dihitung stok, baris itu juga punya **jumlah masuk stok** dalam satuan barang, diisi owner dan boleh berbeda dari kemasan.
- **Pengeluaran (app kasir):** kasir memilih barang dari daftar yang sudah disinkronkan dari BackOffice, mengisi total, dan kategori. Kasir tidak mengisi harga per satuan.
- **Stock opname:** hanya barang yang dihitung stok. Selisih dicatat dalam satuan barang dan dinilai dengan harga rata-rata.
- **Harga rata-rata** per barang yang dihitung stok, dipakai untuk HPP menu resep dan nilai selisih opname.

## Bukan tujuan

- Tab Belanja dan catatan belanja terpisah. Dihapus.
- Konversi satuan (g ke ml, kemasan ke satuan dasar). Satuan dasar barang diisi owner saat membuat barang.
- Selisih jumlah kemasan terhadap jumlah nyata sebagai peringatan. Tidak dibuat sekarang.
- Rendemen, susut, varian menu, dan peringatan stok menipis (kelanjutan nanti).
- Barang tanpa stok di stock opname atau harga rata-rata.

## Anti-tujuan

- Barang yang tidak dihitung stok muncul di opname atau mengubah HPP.
- Owner mengisi total yang sama di dua tempat.
- Pengeluaran dari app kasir menunggu jaringan. Kasir tetap bisa mencatat saat offline; barang yang dipilih dari daftar lokal.
- Harga rata-rata berubah tanpa sumber yang bisa ditelusuri.

## Model data (garis besar)

- **barang** (tabel `ingredients`, nama layar saja yang berubah): id, outlet_id, nama, satuan dasar (`g`, `ml`, `pcs`), `dihitung_stok` (boolean). Tidak ada kategori barang: kategori ada di pengeluaran (lihat `expense_categories`). Satuan dan `dihitung_stok` terkunci setelah barang punya pergerakan stok. Harga rata-rata dan stok disimpan per barang yang dihitung stok.
- **pengeluaran_baris** (ganti `expense_items` yang sudah ada, atau tambahkan kolom): barang_id (opsional), kategori, total, jumlah_stok (wajib bila barang dihitung stok), dan kolom lama yang tetap.
- **Pergerakan stok** dicatat per baris pengeluaran (sumber) dan per dokumen stock opname (sumber), supaya setiap perubahan bisa ditelusuri.
- Riwayat `purchases` dan `purchase_lines` tetap dibaca. Tidak ada data yang dihapus.

## Aturan

1. **Masuk stok** terjadi saat baris pengeluaran punya barang yang dihitung stok. Jumlah masuk = jumlah stok yang diisi owner, dalam satuan barang, lebih dari 0.
2. **Harga rata-rata baru** dihitung dengan total bayar, bukan harga per satuan yang diketik:
   `rata-rata baru = (stok lama positif × rata-rata lama + total bayar) ÷ (stok lama positif + jumlah masuk)`.
   Bila stok lama ≤ 0, rata-rata baru = total bayar ÷ jumlah masuk.
3. **Penjualan** menu resep mengurangi stok barang sesuai resep (jumlah resep × jumlah terjual). Penjualan tidak mengubah harga rata-rata.
4. **Stok awal:** barang yang dihitung stok mulai berjalan saat pengeluaran masuk stok pertama atau hitung stok pertama. Sebelum itu, penjualan tidak mengurangi stoknya dan layar menampilkan "Belum dihitung".
5. **Stock opname:** hanya barang yang dihitung stok. Selisih = hitung − stok sistem. Nilai selisih = selisih × harga rata-rata, masuk "Penyesuaian stok" seperti stok produk.
6. **Barang tanpa stok** bisa dipakai di pengeluaran dan laporan biaya. Tidak muncul di opname, tidak punya harga rata-rata.
7. **Mengubah** barang yang sudah punya stok: nama, kategori, dan penanda stok boleh diubah. Satuan tidak.
8. **Membatalkan** pengeluaran yang sudah masuk stok: harus membalik masuk stok dan menghitung ulang harga rata-rata. Syarat: tidak ada pergerakan stok sesudahnya untuk barang itu. Kalau ada, ditolak: "Sudah ada pergerakan setelahnya; batalkan yang terbaru dulu."
9. **Hak akses:** owner mengelola barang, pengeluaran, dan opname. Kasir hanya mencatat pengeluaran dari daftar barang.
10. **Langganan berakhir:** tulis dikunci seperti fitur lain.

## Batas

- Satu pengeluaran maksimal 50 baris. Jumlah stok di atas 0, sampai 3 desimal, di bawah 1.000.000. Total 0 sampai 1.000.000.000.
- Tanggal pengeluaran tidak di masa depan dan paling lama 90 hari ke belakang.
- Satu barang sekali per pengeluaran untuk masuk stok.

## Keputusan pemilik (7 November 2026)

1. **Pengeluaran dari laci mengurangi kas shift.** Sesuai migrasi 087. Rencana `graceful-riding-hopper` (mencabut pengeluaran kasir) dibatalkan; tidak dijalankan.
2. **Daftar kategori diatur manual oleh owner** per bisnis. Tidak ada daftar tetap di kode. Kategori tidak dihitung stok sendiri; penanda stok ada di barang.

## Pilihan pembangun (bukan keputusan pemilik)

- Nama "Barang" dipakai karena "Produk" sudah berarti menu yang dijual.
- Penanda `dihitung_stok` ada di barang, bukan di kategori. Kategori hanya untuk laporan, dan barang kategori yang sama bisa berbeda penandanya.
- Satuan dikunci setelah ada pergerakan stok, supaya stok tidak salah arti.
- Migrasi: bahan yang ada menjadi barang yang dihitung stok dengan satuan dan stok yang sama. Belanja lama tetap dibaca sebagai riwayat.

## Urutan rilis

1. **BackOffice:** Menu Barang, Menu Resep (dipisah), pengeluaran dengan barang dan jumlah masuk stok, stock opname untuk barang yang dihitung stok. Tab Belanja dihapus.
2. **App kasir:** pilih barang dari daftar yang disinkronkan, dan kirim pengeluaran saat offline sesuai aturan offline yang sudah ada. Pengeluaran kasir sudah ada sejak migrasi 087; rilis ini mengubah pilihan barang dan kategori.

## Pengujian (garis besar)

- Barang dihitung stok: masuk stok menambah stok dan mengubah harga rata-rata sesuai rumus, dengan jumlah nyata berbeda dari kemasan.
- Barang tidak dihitung stok: tidak muncul di opname, tidak mengubah stok atau HPP.
- Satuan terkunci setelah ada pergerakan; penanda stok terkunci setelah ada pergerakan.
- Membatalkan masuk stok membalik stok dan rata-rata; ditolak bila ada pergerakan sesudahnya.
- Penjualan resep mengurangi stok sesuai resep; HPP menu mengikuti rata-rata.
- Stock opname: selisih dan nilainya benar; cek P7 mencakup barang.
- Kasir: daftar barang dari sinkron; pengeluaran offline terkirim saat online lagi.

## Catatan implementasi (migrasi 099, 7 November 2026)

Yang berbeda dari desain di atas, atau yang belum ada di desain:
- **Harga barang** disimpan per satuan dasar dengan kemasan 1 (`pack_qty` 1). Data lama dikonversi sekali di migrasi; HPP tidak berubah. Harga tidak diketik lagi: hanya dari pengeluaran.
- **Kategori**: daftar per bisnis (`expense_categories`). Bisnis yang sudah ada dan bisnis baru mulai dengan `operasional` dan `belanja` supaya aplikasi kasir lama tetap bisa mengirim pengeluaran. Kategori yang dimatikan tidak bisa dipilih, tapi pengeluaran lama tetap menyimpannya.
- **Jumlah masuk stok** boleh kosong saat pengeluaran dicatat (misalnya oleh kasir). Barang dengan jumlah kosong menunggu, dan owner mengisinya di BackOffice (`owner_set_expense_stock`). Mengosongkan lagi membalik stoknya.
- **Pembatalan** pengeluaran yang sudah masuk stok membalik stok dan harga rata-rata. Ditolak jika barang itu sudah bergerak sesudahnya (penjualan, hitung stok, atau pengeluaran lain).
- **Belanja** dihapus dari layar dan dari fungsi yang bisa dipanggil owner (`owner_save_purchase`, `owner_cancel_purchase`, `owner_link_expense_items`). Tabel `purchases` dan `purchase_lines` tetap dibaca sebagai riwayat.
- **Aplikasi kasir** mengambil daftar kategori dan barang lewat `pos_expense_options` saat sinkron, dan menyimpannya di perangkat untuk dipakai offline.
- **Belum ada**: total per kategori di halaman Pengeluaran masih memakai nama lama `operasional` dan `belanja`; kategori baru belum masuk total itu. Pemetaan akun buku besar untuk kategori `belanja` (sebagai pembelian) tetap seperti 073.
