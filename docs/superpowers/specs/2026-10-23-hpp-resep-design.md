# Hitung HPP dari resep di BackOffice (hermes-pos)

Tanggal: 2026-10-23. Tahap 1 dari 3. Tahap 2 (stok bahan) dan 3 (laporan pemakaian) ada di luar lingkup.

## Maksud

Pemilik warung ingin tahu HPP (modal per porsi) tiap menu tanpa menghitung manual, dan tahu untungnya. Sekarang HPP hanya angka ketikan di form produk. Fitur ini menghitungnya dari bahan dan resep, supaya angkanya ikut berubah ketika harga bahan berubah.

Prinsip utama dari pemilik: sistem yang benar dan membantu, tetapi pemakai tidak boleh bingung oleh kerumitan di belakangnya. Istilah "HPP" dan "Modal" tetap dipakai. Satuan tetap gram, kg, ml, liter, dan pcs. Tidak ada sendok atau sachet.

## Tujuan

- Pemilik mengisi bahan dan harga belinya, menulis resep per menu, dan HPP serta untung per porsi muncul otomatis.
- Mengubah harga satu bahan menghitung ulang semua menu yang memakainya.
- Menu tanpa resep tetap memakai HPP ketikan tangan seperti sekarang.
- Aplikasi kasir, transaksi, laporan, nilai stok, dan notifikasi tidak berubah. Semuanya sudah membaca `products.hpp`.

## Bukan tujuan

- Stok bahan, pengurangan bahan saat penjualan, opname bahan, dan laporan pemakaian (tahap 2 dan 3).
- Varian menu, ukuran, topping. Biaya tenaga kerja, listrik, atau sewa. Rendemen dan susut.
- Mengubah HPP penjualan lama. Setiap baris transaksi sudah menyimpan `hpp_unit` saat dijual; nilai itu tidak disentuh.
- Perubahan aplikasi kasir (`apps/pos-mobile`).

## Anti-tujuan (dianggap gagal walau teknis jalan)

- Pemilik harus mengisi semua bahan sebelum melihat satu hasil.
- Angka perkiraan tampil seolah final.
- Salah isi satuan menghasilkan HPP yang salah tanpa peringatan.

## Keputusan pemilik

1. Istilah "HPP (modal per porsi)" ditulis lengkap, dengan satu kalimat penjelasan.
2. Satuan: `g`, `kg`, `ml`, `l`, `pcs`. Tidak ada satuan lain.
3. Tahap 1 saja: HPP dari resep, tanpa stok bahan.
4. Tidak ada beban: kasir tidak melihat atau mengisi apa pun dari fitur ini.

## Perilaku

### Bahan (halaman baru "Bahan" di navigasi, sebelum "Stok")
- Satu bahan: nama, harga beli, isi kemasan (angka + satuan). Contoh: "Susu cair, Rp 18.000, isi 1 liter".
- Daftar menampilkan harga per satuan dasar, mis. "Rp 18 / ml".
- Bahan dibuat per outlet, seperti produk. Nama bahan unik dalam satu outlet (tanpa membedakan huruf besar-kecil).
- Mengubah harga atau isi kemasan: sebelum simpan muncul daftar "menu yang ikut berubah" dengan HPP lama dan baru. Pemilik memilih Simpan atau Batal.
- Bahan yang dipakai resep tidak bisa dihapus. Pesan: "Dipakai di resep: <menu>. Hapus dari resep itu dulu."
- Bahan bisa dibuat dari dalam form resep, tanpa pindah halaman.

### Resep di form produk
- Kolom HPP punya dua keadaan.
  - Tanpa resep: kolom bisa diketik (perilaku sekarang) dan ada tombol "Hitung dari resep".
  - Dengan resep: kolom tidak bisa diketik, tampil angka dengan label "dari resep", ringkasan resep, tombol "Ubah resep" dan "Hapus resep, isi manual". Setelah hapus resep, HPP manual terisi dengan angka terakhir.
- Resep adalah daftar baris: bahan, jumlah, satuan. Satuan baris harus satu keluarga dengan bahan (berat g/kg, volume ml/l, hitungan pcs). Satuan lain ditolak dengan pesan jelas.
- Satu bahan hanya sekali per resep.
- Tampil: HPP, "Untung per porsi Rp X" dan persen kecil, bagian modal dari harga jual.
- Peringatan (tidak memblokir): HPP lebih besar dari harga jual, atau ada bahan berharga Rp 0 ("belum lengkap", angka diberi tanda perkiraan).
- Menyimpan resep menyimpan HPP-nya ke `products.hpp`; produk menandai `hpp_source`.

## Rancangan data

(Pilihan pembangun yang disarankan, bisa disesuaikan selama perilaku di atas tetap.)

- Migrasi `084_hpp_recipes.sql`, gaya sama dengan 074 (RLS aktif, `revoke all`, fungsi `security definer` untuk pemilik).
- Tabel `ingredients` (outlet, nama, harga, isi kemasan, satuan kemasan) dan `recipe_lines` (produk, bahan, jumlah, satuan).
- Kolom `products.hpp_source text not null default 'manual' check (in ('manual','recipe'))`.
- Satu fungsi hitung ulang HPP produk: jumlah baris × (harga ÷ isi kemasan dalam satuan dasar), dibulatkan sesuai `numeric(14,2)`. Dipanggil saat resep disimpan dan saat harga bahan berubah.
- `products.hpp` tetap sumber kebenaran untuk kasir, transaksi, stok, dan laporan. Tidak ada perubahan pada fungsi transaksi.
- Konversi satuan satu tempat saja (di database), dites; frontend hanya menampilkan hasilnya.
- Pratinjau perubahan harga bahan: fungsi yang mengembalikan menu terdampak dengan HPP lama dan baru, tanpa menulis.

## Yang diserahkan ke pembangun

- Bentuk tepat tabel, nama fungsi, dan cara daftar menu terdampak dihitung.
- Apakah `update_product` (074) perlu diubah agar HPP produk ber-resep tidak bisa ditimpa lewat form lama. Harus dijamin: resep aktif, HPP tidak bisa ditimpa manual.
- Akibat pada nilai stok dan notifikasi "harga di bawah HPP" / "selisih HPP bulanan" saat `products.hpp` berubah otomatis. Periksa agar pembukuan stok (P7 di `docs/ACCOUNTING.md`) tetap konsisten.
- Letak "Bahan" di navigasi, teks bantuan, dan terjemahan di `dict.ts`.

## Pilihan pembangun (hasil tinjauan, bukan keputusan pemilik)

1. **Nilai stok.** Laporan nilai stok sudah memakai `products.hpp` yang berlaku sekarang; mengubah HPP manual hari ini pun menggerakkannya tanpa catatan buku besar. Perilaku itu dipertahankan. Tidak ada revaluasi atau perubahan buku besar. Pastikan P7 (jumlah) tetap benar.
2. **Cakupan hitung ulang dan pratinjau.** Semua produk ber-resep di outlet itu, termasuk yang tidak aktif atau tidak dilacak stoknya.
3. **Presisi.** Harga per satuan dasar disimpan tanpa pembulatan; pembulatan hanya pada HPP akhir (`numeric(14,2)`).
4. **Produk baru.** "Hitung dari resep" tersedia juga saat membuat produk. Pembuatan produk dan simpan resep berjalan sebagai satu langkah atomik.
5. **Hak akses.** Sama dengan `update_product`; ikuti penjagaan yang sudah dipakai di sana.
6. **Harga Rp 0.** Resep dengan bahan berharga Rp 0 tetap menjadikan `hpp_source = 'recipe'`. Tanda "perkiraan" dihitung saat membaca, bukan kolom baru.

## Pengujian

- Tes SQL (gaya `supabase/tests/test_08x.sql`): konversi satuan (kg↔g, l↔ml), satuan beda keluarga ditolak, hitung ulang saat harga bahan berubah, hapus bahan terpakai ditolak, resep dihapus mengembalikan HPP manual dengan angka terakhir, penjualan lama tidak berubah, hanya pemilik outlet yang bisa menulis.
- Cek tipe dan e2e BackOffice yang sudah ada tetap hijau; tambah alur: buat bahan, buat resep, lihat HPP dan untung.

## Mockup

Draf tampilan ada di `.superpowers/brainstorm/11407-1792753527/content/` (`hpp-flow.html`, `hpp-product-form.html`); folder itu tidak di-commit.
