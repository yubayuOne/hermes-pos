# Database Notes

## Core tables

- `outlets`: outlet master.
- `cashier_sessions`: binding user auth ke terminal kasir.
- `categories`: kategori yang dibaca terminal.
- `products`: katalog + HPP + harga jual + stok.
- `shifts`: open/close shift.
- `transactions`: header bill.
- `transaction_items`: snapshot harga/HPP pada saat transaksi.
- `payments`: pembayaran.
- `checkout_idempotency`: proteksi retry checkout.
- `held_bills`: index bill yang sedang ditahan.

## Snapshot harga

`transaction_items.hpp_unit` dan `selling_price_unit` menyimpan nilai pada saat transaksi. Perubahan master harga dari aplikasi Owner/Manager tidak mengubah transaksi historis.

## Stock

Stok hanya dikurangi pada `complete_checkout`. Hold/draft tidak mengurangi stok, sehingga kasir tidak dapat mengunci stok tanpa pembayaran.

## Security

RLS membatasi pembacaan ke outlet/cashier session aktif. RPC kritis menjalankan `assert_cashier` menggunakan `auth.uid()` sebelum operasi. Write master produk/kategori tidak diberikan kepada role client authenticated.
