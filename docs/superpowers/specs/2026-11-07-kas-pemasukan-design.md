# Kas: pemasukan dan pengeluaran di satu menu (hermes-pos)

Tanggal: 2026-11-07. Rancangan, belum dikerjakan. Melengkapi `2026-11-07-barang-design.md` (pengeluaran) dan
proyek A (`2026-10-23-pengeluaran-pos-kembali-design.md`, kas laci).

## Maksud

Uang masuk dari luar penjualan (modal tambahan, uang titipan, dan sejenisnya) sekarang dicatat lewat tombol Uang masuk
di setiap kartu shift. Owner menilainya kurang praktis. Uang masuk dari luar tidak berhubungan dengan shift, jadi
dicatat langsung ke kas outlet. Uang keluar sudah tercakup oleh menu Pengeluaran, jadi tidak perlu tombol Uang keluar.

## Tujuan

- Menu Pengeluaran menjadi menu **Kas** dengan dua tab: **Pengeluaran** dan **Pemasukan**.
- Tab Pemasukan mencatat uang masuk dengan **+ Pemasukan**, memakai filter periode dan outlet yang sama.
- Pemasukan menambah **Kas Outlet** dan **Sisa Kas**.
- Daftar Pemasukan menampilkan tanggal, jumlah, dan alasan, dengan paginasi 10 per halaman.

## Bukan tujuan

- Uang keluar baru. Tetap lewat Pengeluaran (sumber Kas Laci atau Kas Outlet).
- Setor ke bank sebagai fitur tersendiri. Kalau diperlukan, dicatat sebagai pengeluaran (kategori "Setoran").
- Mengubah rumus kas laci, kas seharusnya shift, atau pemeriksaan selisih shift.

## Keadaan sekarang (dari kode dan database)

- `cash_movements` menyimpan uang masuk dan keluar per shift (`shift_id` wajib). Setiap baris masuk `cash_ledger`
  dan mengubah kas laci serta kas seharusnya shift itu.
- `owner_add_cash_movement` (073) menerima `in` atau `out` untuk satu shift.
- Tombol per kartu shift di halaman Shift memanggilnya. Tidak ada daftar uang masuk di luar kartu shift.

## Rancangan

### Data
- Tabel baru `outlet_income` (migrasi 104):
  - `id uuid`, `outlet_id` (FK outlet), `business_date date` (tanggal yang dipilih owner),
  - `amount numeric(14,2)` (bilangan bulat, 1 sampai 1.000.000.000), `reason text` (3 sampai 200 huruf),
  - `created_by`, `created_at`.
- Tidak masuk `cash_ledger`, sehingga kas laci dan kas seharusnya shift tidak berubah.
- Baris `cash_movements` `in` dan `out` yang sudah ada tetap apa adanya. Tidak dipindahkan, karena sudah memengaruhi
  kas laci shift lama. Lihat "Keputusan yang saya ambil".

### RPC
- `owner_add_outlet_income(p_outlet_id, p_business_date, p_amount, p_reason)`: cek `is_owner_of_outlet`,
  `subscription_active`, nominal, dan alasan. Tanggal tidak boleh di masa depan.
- `owner_list_outlet_income(p_outlet_id, p_from, p_to, p_page)`: `{total, rows}`, 10 per halaman. Rentang tanggal
  dibatasi seperti `owner_list_shifts` (103).
- `owner_update_outlet_income` dan `owner_delete_outlet_income`: ubah dan hapus, sama seperti item pengeluaran.

### Tab Pemasukan
- Tombol **+ Pemasukan** membuka dialog: tanggal (default hari ini), jumlah, alasan (chip "Modal tambahan",
  "Uang titipan", atau teks bebas).
- Daftar: tanggal, alasan, jumlah, dan tombol ubah dan hapus (IconAction, paling kanan).

### Ringkasan di atas (menu Kas)
- Kas Outlet = penjualan + pemasukan periode.
- Pengeluaran = semua pengeluaran periode.
- Sisa Kas = Kas Outlet − Pengeluaran.
- Perhitungan Kas Outlet di server (getSummary) ikut menjumlahkan `outlet_income`.

### Halaman Shift
- Tombol Uang masuk dan Uang keluar di kartu shift TETAP (diubah saat implementasi): keduanya dipakai untuk
  memperbaiki selisih kas laci satu shift. Menghapusnya berarti selisih shift tidak bisa diperbaiki. Lihat keputusan 5.

### Perubahan kode (perkiraan)
- SQL: `104_outlet_income.sql`, `test_104.sql`.
- Server: `listOutletIncome`, `addOutletIncome`, `updateOutletIncome`, `deleteOutletIncome`, dan `getSummary`.
- Back office: `routes/_app/expenses.tsx` menjadi halaman Kas dengan dua tab, label menu "Kas". Route `/expenses`
  tetap supaya tautan lama tidak rusak. Halaman Shift: tombol uang masuk dan keluar dihapus.

## Keputusan yang saya ambil (bisa diubah)

1. Data `cash_movements` lama tidak dipindahkan dan tidak tampil di tab Pemasukan. Kas laci shift lama tetap utuh.
2. Pemasukan bisa diubah dan dihapus, seperti item pengeluaran.
3. Tanggal pemasukan bisa mundur, tidak bisa maju.
4. Pemasukan tidak masuk `ledger` dan laporan kas laci, supaya pemeriksaan keseimbangan shift tidak berubah.
5. Tombol Uang masuk/keluar di kartu shift tetap, karena dipakai memperbaiki selisih kas laci. Pemasukan dari luar
   sekarang punya tempat sendiri di tab Pemasukan. Kalau tombol shift ingin dihapus juga, perlu keputusan terpisah.
6. Ringkasan dashboard (Ringkasan) tidak berubah: pemasukan hanya masuk ke Kas Outlet di menu Kas.

## Pengujian

- SQL: pemasukan tersimpan, tidak masuk `cash_ledger`; total dan halaman daftar benar; outlet lain ditolak; nominal
  0, pecahan, dan tanggal masa depan ditolak; `cash_ledger` dan kas shift lama tidak berubah.
- Back office: tab Pemasukan dan Pengeluaran berganti tanpa mengubah filter; Sisa Kas naik setelah pemasukan dicatat.
- Tes yang sudah ada tetap PASS.

## Urutan rilis

1. SQL: migrasi 104 dan tes.
2. Server dan ringkasan Kas Outlet.
3. Back office: tab Pemasukan dan label menu Kas.
4. Tombol Uang masuk dan Uang keluar di halaman Shift: tidak dihapus (lihat keputusan 5).
