# Sistem Pembukuan HERMES POS

Status, 19 Okt 2026: **dibangun dengan keputusan default di bagian 13** (migrasi 072 sampai 076). Dokumen ini menggantikan
pendekatan "balancing ± angka" (migrasi 071) dengan sistem yang setiap angkanya bisa dibuktikan dan selalu seimbang.

**Sudah dibangun:**
- Jurnal (`ledger`, view di atas dokumen yang tidak pernah diubah), diskon bill dibagi ke baris, P1 sampai P5 dan P7
  (`ledger_checks`), laporan produk dan laba rugi memakai angka yang sama (072, 074, 075).
- Koreksi bill (void + pengganti, termasuk pindah cara bayar), uang masuk dan keluar laci dengan alasan, pembatalan dan
  penambahan barang pengeluaran (073).
- Dokumen stok: stok awal, stok masuk, penyesuaian, hitung stok; form produk tidak menimpa stok (074).
- QRIS dicocokkan saat tutup shift (POS) dan saat tutup hari (mutasi bank); tutup dan kunci hari, buka kunci dengan
  alasan; laba rugi memuat penyesuaian stok, selisih kas, dan selisih QRIS; jejak koreksi per hari di Tutup hari (075).
- Tutup hari dan kunci hari dihapus (078): pemilik memperbaiki selisih shift dengan Uang masuk / Uang keluar kapan saja;
  hari yang ditutup sebelumnya tetap sebagai riwayat; pengingat "hari belum ditutup" berhenti.
- Notifikasi: void, selisih shift (≥ Rp10.000 atau > 1% omzet), pemeriksaan malam (P gagal 8 hari terakhir, hari belum
  ditutup ≥ 2 hari, shift buka > 16 jam) (076).

**Belum dibangun** (bagian di bawah tetap rancangan): jenis uang laci terpisah (modal, prive, setor bank, brankas) dan
akun bank selain QRIS; P6 dan P8 sebagai aturan sendiri; dokumen stok dari aplikasi kasir; catatan wajib kasir untuk
selisih besar (5.1 no. 4); ambang notifikasi yang bisa diubah; notifikasi harga di bawah HPP, diskon besar, bill ditahan
lama, stok minus, dan selisih HPP bulanan; laporan jejak koreksi lintas periode dan klik sampai dokumen; rujukan
"mengoreksi tanggal X" (6.1): sekarang hari terkunci menolak perubahan, koreksinya lewat refund di hari yang masih buka.

Tujuan: **laporan selalu sama dengan apa yang terjadi.** Setiap rupiah, setiap item, dan setiap gelas stok punya asal yang
jelas, tercatat sekali, tidak pernah diubah diam-diam, dan dicocokkan dengan kenyataan (uang di laci, uang di rekening, barang
di rak).

---

## 1. Arti "balanced"

Sistem disebut seimbang kalau delapan persamaan ini **selalu** benar, untuk setiap shift, hari, outlet, dan periode. Sistem
memeriksanya sendiri (bagian 8); kalau satu saja tidak cocok, itu bug atau kecurangan, dan pemilik diberi tahu.

| # | Persamaan | Dicocokkan dengan kenyataan lewat |
| --- | --- | --- |
| P1 | Setiap dokumen: total masuk = total keluar di jurnal | (internal) |
| P2 | Setiap bill: Σ baris item − diskon = total = Σ pembayaran | (internal) |
| P3 | Penjualan bersih = tunai bersih + QRIS bersih | (internal) |
| P4 | Σ penjualan per produk = penjualan bersih (diskon bill dibagi ke baris) | (internal) |
| P5 | Kas shift: awal + tunai masuk − tunai keluar = kas seharusnya | **hitung uang laci** saat tutup shift |
| P6 | QRIS: QRIS masuk − refund QRIS = QRIS seharusnya | **total di aplikasi merchant / mutasi bank** |
| P7 | Stok per produk: awal + masuk − terjual + kembali ± penyesuaian = akhir | **stok opname** (hitung fisik) |
| P8 | Laba = penjualan bersih − HPP − beban | (internal) |

Selisih antara buku dan kenyataan (P5, P6, P7) **tidak pernah disembunyikan** ke dalam omzet atau stok. Selisih punya akunnya
sendiri (Selisih kas, Selisih QRIS, Penyesuaian stok) dan tampil terpisah di laporan.

---

## 2. Tujuh prinsip

1. **Catatan tidak pernah diubah atau dihapus.** Kesalahan diperbaiki dengan dokumen baru yang membatalkan dokumen lama
   (*reversal*), lalu kejadian yang benar dicatat ulang. Dokumen lama tetap terlihat, ditandai "dibatalkan oleh …".
2. **Setiap kejadian adalah dokumen dengan jenis yang jelas.** Tidak ada angka "lain-lain" tanpa jenis. Daftar lengkap ada di
   bagian 4.
3. **Pembukuan dua sisi.** Setiap dokumen otomatis menghasilkan baris jurnal yang selalu seimbang (masuk = keluar). Laporan dibaca
   dari jurnal, bukan dihitung ulang dari banyak tabel. Karena itu laporan mana pun pasti cocok satu sama lain.
4. **Dicocokkan dengan kenyataan di tiga titik:** tutup shift (kas dan QRIS), tutup hari (semua shift, mutasi bank), stok opname.
5. **Hari yang sudah ditutup dikunci.** Koreksi untuk hari yang terkunci masuk ke hari berjalan, dengan rujukan ke tanggal asal.
   Laporan yang sudah dicetak tidak berubah.
6. **Setiap catatan punya jejak:** siapa, kapan, dari perangkat apa, dan alasan (wajib untuk void, refund, koreksi,
   penyesuaian, kas keluar non-penjualan).
7. **Yang aneh dilaporkan.** Selisih, koreksi, pola void, stok minus, dan anomali lain memicu notifikasi (bagian 9).

---

## 3. Akun

Satu set akun per bisnis; setiap baris jurnal juga membawa outlet, shift, kasir, dan (untuk barang) produk.

| Kelompok | Akun | Keterangan |
| --- | --- | --- |
| Aset | **Kas laci** | Per shift. Uang fisik di laci kasir. |
| Aset | **Kas brankas** | Per outlet. Uang di luar laci (modal awal diambil dari sini, setoran ke bank dari sini). |
| Aset | **QRIS tertunda** | Uang pembeli lewat QRIS yang belum masuk rekening. Turun saat settlement dicocokkan. |
| Aset | **Bank** | Rekening usaha. |
| Aset | **Persediaan** | Per produk yang dilacak stoknya, dalam jumlah dan nilai HPP. |
| Pendapatan | **Penjualan kotor** | Harga × jumlah. |
| Pengurang pendapatan | **Diskon item**, **Diskon bill**, **Diskon voucher**, **Retur (refund)** | Terpisah supaya pemilik tahu ke mana omzet "hilang". |
| Beban | **HPP** | Harga pokok barang yang terjual. |
| Beban | **Beban operasional** | Per kategori pengeluaran. |
| Beban | **Penyesuaian stok** | Rusak, hilang, kedaluwarsa, selisih opname. |
| Beban / pendapatan lain | **Selisih kas**, **Selisih QRIS** | Uang lebih (+) atau kurang (−) saat dicocokkan. |
| Ekuitas | **Modal** (setoran pemilik), **Prive** (pemilik ambil uang) | Supaya uang pemilik tidak tercampur dengan omzet. |
| Informasi | **Pembelian bahan** | Belanja bahan (lihat 3.1). |

### 3.1 Belanja bahan dan HPP (keputusan default: stok produk jadi)

Stok dilacak per **menu/produk jadi**, dan HPP per menu diisi pemilik (seperti sekarang). Belanja bahan (gula, susu) dicatat
sebagai **Pembelian bahan**: mengurangi kas, tampil di arus kas, tetapi **tidak** masuk laba rugi, karena biayanya sudah diwakili
HPP menu. Supaya HPP tidak meleset tanpa ketahuan, laporan bulanan menampilkan:

> **Selisih HPP** = pembelian bahan − HPP menu yang terjual.

Kalau angka ini terus besar, HPP menu perlu disesuaikan. Pilihan yang lebih akurat (stok bahan baku + resep per menu, HPP dari
harga beli) bisa ditambahkan kemudian tanpa mengubah prinsip apa pun di dokumen ini (bagian 13).

**Sudah ada: HPP dari resep (084 sampai 086).** Pemilik mengisi bahan (harga kemasan dan isinya) dan resep per menu di halaman
Bahan & Resep; HPP menu dihitung otomatis dan disimpan di `products.hpp`, kolom yang sama yang dibaca kasir, transaksi, nilai
stok, dan laporan. Aturannya:

- Penjualan yang sudah terjadi menyimpan `hpp_unit` saat dijual. Mengubah harga bahan menggeser HPP **ke depan**, tidak
  mengubah laporan lama.
- Nilai persediaan (jumlah × HPP) memakai HPP yang berlaku, seperti ketika HPP diubah tangan; tidak ada pencatatan revaluasi.
  Cek P7 menghitung jumlah, jadi tidak terpengaruh.
- Menu ber-resep tidak bisa dikunci HPP-nya dari form produk. Menghapus resep mengembalikan menu ke HPP ketikan dengan angka
  terakhir.
- Belum ada stok bahan baku: penjualan tidak mengurangi bahan, dan pembelian bahan tetap dicatat seperti di atas.

---

## 4. Dokumen dan jurnalnya

Setiap baris di tabel ini adalah satu jenis dokumen. Kolom "Jurnal" menulis akun yang naik (+) dan turun (−); selalu seimbang.

### 4.1 Penjualan

| Dokumen | Dibuat oleh | Jurnal | Stok |
| --- | --- | --- | --- |
| **Penjualan tunai** | Kasir (POS) | Kas laci +total; Penjualan kotor +Σ(harga×qty); Diskon item/bill/voucher −(masing-masing) | Persediaan −qty per produk; HPP +qty×HPP saat itu |
| **Penjualan QRIS** | Kasir | Sama, tetapi QRIS tertunda +total | Sama |
| **Split bill** | Kasir | Setiap bayaran adalah penjualan sendiri; diskon bill induk sudah dibagi ke baris (sudah ada, 023) | Per bayaran |
| **Bill ditahan / draft** | Kasir | **Tidak ada jurnal** sampai dibayar | Belum berkurang |
| **Menu sementara** (050) | Kasir | Seperti penjualan; tanpa HPP dan stok | – |

Diskon bill **dibagi ke setiap baris item** secara proporsional saat bill dibayar (cara yang sama dengan split bill). Karena itu
penjualan per produk selalu berjumlah sama dengan omzet (P4). Saat ini laporan produk memakai harga setelah diskon item saja,
sehingga jumlahnya lebih besar dari omzet ketika ada diskon bill; ini diperbaiki.

### 4.2 Pembatalan, refund, dan koreksi bill

| Dokumen | Dibuat oleh | Jurnal | Stok |
| --- | --- | --- | --- |
| **Void** | Kasir dengan kode persetujuan, atau pemilik | Kebalikan persis dari penjualan, pada tanggal void | Kembali ke persediaan |
| **Refund item** | Kasir dengan kode | Retur +nilai; Kas laci − (tunai) atau QRIS tertunda − (QRIS) | Kembali hanya jika dipilih "kembalikan ke stok"; jika tidak, tidak berubah (barang terbuang = Penyesuaian stok) |
| **Koreksi bill** (baru) | Pemilik, atau kasir dengan kode | **Void bill asal + bill pengganti** dalam satu langkah, saling terhubung. Pembayaran pindah ke bill pengganti; kalau totalnya berbeda, selisihnya ditagih atau dikembalikan dengan cara bayar yang dipilih | Ikut benar otomatis |
| **Pindah cara bayar** (baru) | Pemilik, atau kasir dengan kode | Kas laci ↔ QRIS tertunda sebesar total bill; omzet tidak berubah | – |

Dengan koreksi bill, salah item, salah jumlah, salah harga, dan salah menu semuanya diperbaiki tanpa merusak laporan produk dan
stok. Inilah pengganti fitur "ubah item" dan "koreksi omzet".

### 4.3 Uang di luar penjualan

| Dokumen | Dibuat oleh | Jurnal |
| --- | --- | --- |
| **Modal awal shift** | Kasir saat buka shift | Kas laci +; Kas brankas − |
| **Pengeluaran dari laci** | Kasir | Beban operasional / Pembelian bahan +; Kas laci − |
| **Pengeluaran bukan dari laci** | Kasir atau pemilik | Beban / Pembelian bahan +; Kas brankas atau Bank − |
| **Pembatalan pengeluaran** | Pemilik | Kebalikan pengeluaran asal (lalu catat ulang yang benar) |
| **Setoran modal** | Pemilik | Kas brankas atau Bank +; Modal + |
| **Ambil uang pemilik** | Pemilik, atau kasir dengan kode | Prive +; Kas laci atau Kas brankas − |
| **Setor ke bank** | Pemilik | Bank +; Kas brankas − |
| **Uang laci ke brankas** (saat tutup shift) | Kasir | Kas brankas +; Kas laci − |

### 4.4 Penutupan dan pencocokan

| Dokumen | Dibuat oleh | Jurnal |
| --- | --- | --- |
| **Tutup shift** | Kasir: isi **uang laci yang dihitung** dan **total QRIS di aplikasi merchant** | Selisih kas = dihitung − seharusnya; Selisih QRIS = dilaporkan − seharusnya. Masing-masing dibukukan ke akunnya. |
| **Tutup hari** (sampai 078) | Pemilik | Dihapus di 078. Hari yang ditutup sebelumnya: QRIS yang masuk rekening → Bank; sisa beda → Selisih QRIS. |
| **Stok opname** | Pemilik atau kasir | Untuk setiap produk yang dihitung: selisih fisik − buku → Penyesuaian stok (jumlah dan nilai HPP). |

### 4.5 Stok

| Dokumen | Dibuat oleh | Jurnal |
| --- | --- | --- |
| **Stok masuk** (produksi atau pembelian produk jadi) | Pemilik atau kasir | Persediaan +qty (nilai HPP) |
| **Penyesuaian stok** (rusak, hilang, kedaluwarsa, dipakai sendiri) | Pemilik, atau kasir dengan alasan | Persediaan −; Penyesuaian stok + |
| **Opname** | lihat 4.4 | |

Stok **tidak lagi bisa ditimpa** dari form produk. Form produk hanya menampilkan stok; perubahan stok selalu lewat salah satu
dokumen di atas, sehingga riwayat setiap produk bisa ditelusuri dari awal.

---

## 5. Pencocokan dengan kenyataan

### 5.1 Tutup shift (kasir, di POS)
1. Sistem menampilkan rincian kas seharusnya: awal + penjualan tunai − refund tunai − pengeluaran laci ± uang lain.
2. Kasir menghitung uang laci lalu mengisinya (sudah ada).
3. **Baru:** kasir membuka aplikasi merchant QRIS, lalu mengisi total transaksi QRIS shift itu. Sistem menampilkan selisih QRIS
   seperti selisih kas.
4. Selisih di atas ambang (bagian 9) mewajibkan catatan alasan dari kasir.

### 5.2 Shift (pemilik, di backoffice)
Tidak ada tutup hari dan tidak ada kunci hari sejak migrasi 078: kasir menutup shift di aplikasi, dan pemilik tidak punya
langkah harian. Satu layar per outlet per tanggal bisnis menampilkan kas dan QRIS tiap shift, pemeriksaan P1–P7, dan
koreksi hari itu. Selisih kas diperbaiki kapan saja dengan **Uang masuk** (laci kurang) atau **Uang keluar** (laci lebih),
dengan alasan. Hari yang ditutup sebelum 078 tetap tercatat sebagai riwayat, termasuk baris QRIS ke Bank-nya.

### 5.3 Stok opname
Pilih produk (semua, per kategori, atau acak), isi jumlah fisik, lalu sistem menampilkan selisih per produk sebelum disimpan.
Disarankan mingguan untuk produk bernilai tinggi dan bulanan untuk sisanya.

---

## 6. Koreksi: tabel keputusan

| Yang salah | Diperbaiki dengan | Yang **tidak** boleh dilakukan |
| --- | --- | --- |
| Item, jumlah, harga, atau menu di bill | Koreksi bill (void + pengganti) | Mengubah bill atau menambah "omzet ±" |
| Cara bayar | Pindah cara bayar | Mengubah bill |
| Bill dobel atau batal | Void | Menghapus bill |
| Barang dikembalikan pembeli | Refund item | Void kalau sebagian item tetap terjual |
| Nominal pengeluaran | Batalkan pengeluaran + catat ulang | Mengubah angka pengeluaran |
| Uang laci lebih/kurang tanpa sebab | Selisih kas saat tutup shift | Menyesuaikan omzet |
| Pemilik ambil uang / tambah modal | Prive / Modal | Mencatatnya sebagai pengeluaran atau omzet |
| Stok fisik beda | Opname atau penyesuaian stok | Menimpa angka stok |

### 6.1 Hari yang sudah dikunci
Koreksi tetap boleh, tetapi dokumennya bertanggal hari berjalan dan membawa rujukan "mengoreksi tanggal X". Laporan hari X
tidak berubah. Laporan periode menampilkan baris **Koreksi periode lalu** supaya terlihat.

---

## 7. Laporan

Setiap angka di laporan bisa diklik sampai ke dokumen sumbernya.

| Laporan | Isi | Persamaan |
| --- | --- | --- |
| **Ringkasan** | Omzet bersih, tunai, QRIS, bill, laba, selisih, peringatan | P3, P8 |
| **Rekonsiliasi kas** (per shift / hari) | Awal, tunai masuk, refund tunai, pengeluaran laci, uang lain, seharusnya, dihitung, selisih | P5 |
| **Rekonsiliasi QRIS** (per shift / hari) | QRIS masuk, refund QRIS, seharusnya, dilaporkan kasir, masuk rekening, selisih | P6 |
| **Penjualan** | Kotor, diskon per jenis, retur, bersih; per hari, outlet, kasir, cara bayar | P2, P3 |
| **Produk** | Terjual, omzet bersih (setelah diskon bill dibagi), HPP, laba per produk dan kategori | P4 |
| **Mutasi stok** (per produk) | Awal, masuk, terjual, kembali, penyesuaian, akhir, hasil opname | P7 |
| **Laba rugi** | Penjualan bersih, HPP, laba kotor, beban per kategori, penyesuaian stok, selisih kas dan QRIS, laba operasional | P8 |
| **Arus kas** | Kas laci, brankas, bank, QRIS: saldo awal, masuk per jenis, keluar per jenis, saldo akhir | P1 |
| **Jejak koreksi** | Semua void, refund, koreksi bill, pindah bayar, pembatalan pengeluaran, penyesuaian: siapa, kapan, alasan, nilai | – |

---

## 8. Pemeriksaan otomatis

Database memeriksa P1–P8 setiap kali dokumen disimpan (P1, P2) dan saat tutup shift dan tutup hari (P3–P8). Kalau gagal:
- penyimpanan ditolak untuk P1 dan P2 (tidak mungkin ada jurnal yang tidak seimbang);
- tutup hari ditolak untuk P3–P8, dengan penjelasan baris mana yang tidak cocok;
- pemeriksaan malam (pg_cron) menjalankan semuanya lagi untuk 7 hari terakhir dan mengirim notifikasi kalau ada yang berubah.

---

## 9. Deteksi dan notifikasi

Ambang bawaan, bisa diubah pemilik di Pengaturan.

| Kejadian | Ambang bawaan |
| --- | --- |
| Selisih kas atau QRIS saat tutup shift | > Rp10.000 atau > 1% omzet shift |
| Void atau refund oleh satu kasir | > 3 per shift, atau > 5% omzet shift |
| Koreksi bill atau pindah cara bayar | setiap kali, ringkas per hari |
| Koreksi untuk hari yang sudah dikunci | setiap kali |
| Stok produk minus | setiap kali |
| Harga jual di bawah HPP | saat produk disimpan dan saat terjual |
| Diskon manual besar | > 30% dari bill |
| Bill ditahan terlalu lama | > 4 jam |
| Shift belum ditutup | > 16 jam sejak dibuka |
| Hari belum ditutup pemilik | > 2 hari |
| Selisih HPP bulanan (3.1) | > 10% |
| Pemeriksaan otomatis gagal (8) | setiap kali |

---

## 10. Hak akses dan jejak

| Tindakan | Kasir | Kasir + kode persetujuan | Pemilik |
| --- | --- | --- | --- |
| Penjualan, tahan bill, split, pengeluaran, tutup shift | ✓ | | ✓ |
| Void, refund, koreksi bill, pindah cara bayar | | ✓ | ✓ |
| Ambil uang dari laci (prive) | | ✓ | ✓ |
| Stok masuk, penyesuaian stok, opname | ✓ (dengan alasan) | | ✓ |
| Pembatalan pengeluaran, setoran modal, setor bank | | | ✓ |
| Tutup dan kunci hari, koreksi hari terkunci | | | ✓ |

Setiap dokumen menyimpan: pembuat (kasir atau akun pemilik), waktu server dan waktu perangkat, perangkat, outlet, shift, alasan,
dan dokumen yang dikoreksi. Tidak ada tombol hapus di mana pun.

---

## 11. Perbedaan dengan sistem sekarang

| Sekarang | Masalah | Rancangan |
| --- | --- | --- |
| Laporan dihitung ulang dari banyak tabel | Laporan yang berbeda bisa memberi angka berbeda | Satu jurnal; semua laporan membaca jurnal |
| Balancing "omzet ±" dan "pengeluaran ±" (071) | Angka tidak terhubung ke item, produk, dan stok | Dihapus; diganti koreksi bill dan pembatalan pengeluaran |
| Balancing "kas ±" (071) | Tidak jelas jenisnya | Diganti dokumen berjenis: modal, prive, setor, selisih |
| Stok bisa ditimpa di form produk | Tidak ada jejak | Hanya lewat dokumen stok |
| QRIS tidak pernah dicocokkan | Uang QRIS hilang tidak ketahuan | Dicocokkan saat tutup shift dan tutup hari |
| Laporan produk memakai harga setelah diskon item saja | Σ produk ≠ omzet saat ada diskon bill | Diskon bill dibagi ke baris |
| Tidak ada kunci hari | Laporan lama bisa berubah | Tutup dan kunci hari |
| Uang pemilik tercampur | Prive terlihat seperti pengeluaran atau selisih | Akun Modal dan Prive |
| Pemeriksaan hanya selisih kas | Kesalahan lain tidak terdeteksi | P1–P8 dan notifikasi |

Data lama (sebelum sistem ini) dimigrasikan dengan membuat jurnal dari dokumen yang sudah ada (bill, refund, pengeluaran, kas
awal). Hasilnya diperiksa dengan P1–P8. Koreksi balancing 071 yang sudah terlanjur dibuat dipindah apa adanya ke akun
"Koreksi lama (sebelum pembukuan)", supaya tidak hilang dan tetap terlihat.

---

## 12. Tahapan pengerjaan

Setiap tahap bisa dipakai sendiri dan tidak merusak data.

| Tahap | Isi | Menyentuh |
| --- | --- | --- |
| **1. Fondasi** | Tabel jurnal + akun; jurnal otomatis dari penjualan, void, refund, pengeluaran, kas awal; migrasi data lama; diskon bill dibagi ke baris; pemeriksaan P1–P4, P8; laporan baca dari jurnal | Database, backoffice |
| **2. Koreksi yang benar** | Koreksi bill, pindah cara bayar, pembatalan pengeluaran, modal/prive/setor/brankas; hapus balancing 071 omzet/pengeluaran | Database, POS, backoffice |
| **3. Stok** | Dokumen stok masuk, penyesuaian, opname; form produk tidak bisa menimpa stok; laporan mutasi stok; P7 | Database, POS, backoffice |
| **4. Pencocokan dan kunci** | QRIS saat tutup shift (POS); layar tutup hari dan kunci; rekonsiliasi QRIS dan bank; P5, P6 | Database, POS, backoffice |
| **5. Deteksi** | Notifikasi bagian 9, pemeriksaan malam, laporan jejak koreksi, klik sampai dokumen | Database, backoffice |

Aplikasi kasir (POS) perlu build baru di tahap 2, 3, dan 4.

---

## 13. Keputusan default yang perlu dikonfirmasi pemilik

| Keputusan | Default dalam rancangan ini | Alternatif |
| --- | --- | --- |
| Tingkat stok | Produk jadi + HPP per menu (3.1) | Bahan baku + resep: HPP dari harga beli, paling akurat, input lebih banyak |
| Pencocokan QRIS | Kasir isi total QRIS saat tutup shift, pemilik isi mutasi bank saat tutup hari | Salah satu saja |
| Kunci periode | Saat pemilik menutup hari | Otomatis per bulan; atau tanpa kunci |
| Koreksi bill | Pemilik langsung; kasir dengan kode persetujuan | Hanya pemilik |
| Kas brankas | Dicatat terpisah dari laci | Tidak dicatat (modal awal dianggap dari luar sistem) |
| Ambang notifikasi | Bagian 9 | Diatur per bisnis |
