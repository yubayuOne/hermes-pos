# Login Akun Owner dan PIN Kasir

## Alur

1. Owner login di aplikasi POS dengan **email dan password** akunnya. Sesi ini bertahan sampai "Keluar Akun".
2. Layar **Pilih Kasir** menampilkan kasir yang didaftarkan owner pada akun itu.
3. Kasir memilih namanya, lalu memasukkan **PIN 6 angka** yang dibuat owner.
4. Setelah PIN benar kasir masuk ke aplikasi. Akun tetap login.
5. **Setting → Ganti Kasir** kembali ke layar Pilih Kasir tanpa logout akun (keranjang yang sedang dibuat dikosongkan setelah konfirmasi).
6. **Setting → Keluar Akun** (atau tombol di layar Pilih Kasir) logout akun. Bila masih ada antrean offline, aplikasi meminta konfirmasi.

Aplikasi yang ditutup paksa membuka kasir terakhir tanpa meminta PIN lagi, supaya shift yang sedang berjalan tidak terganggu. Serah terima kasir dilakukan lewat Ganti Kasir.

## Keamanan

- PIN disimpan sebagai hash bcrypt di `cashier_sessions.pin_hash`. Kolom ini tidak bisa dibaca aplikasi (hak akses kolom, migrasi 026).
- PIN diperiksa server (`verify_cashier_pin`). 5 kali salah berturut-turut mengunci kasir itu 5 menit.
- Memeriksa PIN butuh internet. Daftar kasir tetap tampil dari salinan terakhir saat offline.
- `set_cashier_pin` dan `admin_create_cashier` hanya bisa dijalankan service role atau SQL Editor, tidak oleh aplikasi.

## Mendaftarkan kasir (sementara lewat SQL Editor, sampai backoffice siap)

```sql
-- id akun owner: Supabase → Authentication → Users. id outlet: tabel outlets.
select public.admin_create_cashier('<AUTH_USER_ID>', '<OUTLET_ID>', 'Budi', '123456', 'POS 1');

-- Ganti PIN, atau beri PIN untuk kasir lama yang belum punya PIN:
select public.set_cashier_pin('<CASHIER_ID>', '654321');

-- Nonaktifkan kasir (hilang dari layar Pilih Kasir):
update public.cashier_sessions set is_active = false where cashier_id = '<CASHIER_ID>';
```

Kasir lama (satu baris per akun sebelum migrasi 026) otomatis muncul di layar Pilih Kasir, tetapi harus diberi PIN dulu lewat `set_cashier_pin`.

## Untuk backoffice (migrasi 027)

Kasir adalah baris milik akun owner, jadi backoffice cukup login sebagai owner dan memanggil RPC berikut. Service role key tidak diperlukan dan tidak boleh ada di browser.

| RPC | Fungsi |
| --- | --- |
| `register_business(nama_bisnis, nama_outlet, telepon)` | Pendaftaran owner baru: membuat bisnis dan outlet pertama. Dipanggil sekali setelah sign-up. |
| `my_business_id()` | Id bisnis akun yang login (null bila belum mendaftar). |
| `owner_create_outlet`, `owner_update_outlet` | Tambah / ubah / nonaktifkan outlet. |
| `owner_list_cashiers()` | Semua kasir bisnis (termasuk nonaktif), status PIN dan kunci. |
| `owner_create_cashier(outlet, nama, pin, terminal)` | Daftarkan kasir + PIN 6 angka. |
| `owner_update_cashier`, `owner_set_cashier_pin`, `owner_set_cashier_active` | Ubah data, ganti PIN (sekaligus membuka kunci), aktif/nonaktif. |

### Data dan laporan owner (migrasi 028)

| RPC | Fungsi |
| --- | --- |
| `owner_sales_summary(outlet\|null, dari, sampai, dari_banding, sampai_banding)` | Penjualan, laba, tunai/QRIS, diskon, bill batal, per hari, per jam, per outlet, per kasir, 10 produk terlaris. `null` = semua outlet. |
| `owner_list_bills(outlet\|null, dari, sampai, status, cari, limit, offset)` | Daftar bill dengan paginasi. Status: `completed`, `held`, `voided`, `all`. Mengembalikan `{ total, rows }`. |
| `owner_get_bill_items(bill_id)` | Item satu bill. |
| `create_/update_/delete_category`, `create_/update_/delete_product` | Katalog. Sekarang juga berlaku untuk outlet yang belum punya kasir bila dipanggil owner. |

Owner juga boleh membaca langsung (`select`) tabel kategori, produk, shift, transaksi, item, pembayaran, dan buku kas semua outlet bisnisnya. Penulisan tetap lewat RPC.

Aturan: satu akun = satu bisnis dengan banyak outlet; nama kasir unik per akun (huruf besar/kecil tidak dibedakan). Akun lama yang sudah punya kasir otomatis dijadikan owner satu bisnis oleh migrasi 027.
