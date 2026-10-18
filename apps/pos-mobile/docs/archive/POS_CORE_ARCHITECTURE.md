# HERMES POS Core Architecture

## Tujuan

HERMES POS Cashier diperlakukan sebagai terminal POS yang transactional. UI tidak menjadi sumber kebenaran untuk operasi finansial atau shift. PostgreSQL/Supabase menjadi source of truth untuk state kritis.

## Prinsip

1. **Database is authoritative**
   - Open/close shift dan checkout selalu melalui RPC.
   - State Zustand/React hanya cache tampilan terminal.
   - Operasi lokal tidak boleh mengubah state seolah-olah database sudah berhasil.

2. **Atomic financial operations**
   - Checkout dilakukan dalam satu RPC.
   - Harga dan stok dibaca server-side dari `products`.
   - Payment, transaction, items, dan stock update berada dalam transaksi database.

3. **Idempotent checkout**
   - Setiap payment attempt memiliki satu idempotency key yang dipertahankan ketika request gagal/timeout.
   - Retry dengan key yang sama mengembalikan transaksi yang sudah dibuat, bukan membuat transaksi baru.

4. **Shift serialization**
   - `open_shift` menggunakan advisory lock sebelum mengecek shift aktif.
   - `complete_checkout`, `save_held_bill`, dan `close_shift` mengunci row shift (`FOR UPDATE`).
   - Checkout dan close shift tidak dapat berjalan bersamaan pada shift yang sama.

5. **Safe shift closure**
   - Shift tidak dapat ditutup jika masih ada Bill Ditahan.
   - Uang fisik wajib dimasukkan sebelum close.
   - Expected cash dan variance dihitung server-side.

6. **Clear failure semantics**
   - Error backend tidak dikonversi menjadi "data kosong".
   - Pesan error user-facing dibuat singkat dan actionable.
   - Jika status shift di server berubah di luar terminal, terminal melakukan reconciliation.

## Core flow

```text
Login
  -> load cashier session
  -> sync open shift from DB

Open Shift
  -> open_shift RPC
  -> DB returns shift id
  -> fetch open shift
  -> set local state

Cashier
  -> local cart only
  -> payment UI validates UX constraints

Checkout
  -> stable idempotency key
  -> complete_checkout RPC
      -> validate cashier session
      -> lock active shift
      -> validate shift open
      -> lock products
      -> validate stock
      -> read current price/HPP
      -> write transaction/items/payment
      -> decrement stock
      -> persist idempotency record
  -> receipt / UI update

Close Shift
  -> physical cash input
  -> close_shift RPC
      -> lock shift
      -> validate ownership
      -> validate open
      -> reject held bills
      -> calculate cash sales
      -> calculate expected cash + variance
      -> mark closed
  -> clear local terminal state
```

## Yang sengaja tidak dilakukan

- Tidak ada `setShift(null)` sebagai pengganti close database.
- Tidak ada harga final yang dipercaya dari client saat checkout.
- Tidak ada checkout yang hanya bergantung pada validasi UI.
- Tidak ada tombol aksi yang belum punya implementasi nyata.
- Tidak ada retry payment dengan idempotency key baru.

## Migration

`009_pos_core_integrity.sql` adalah hardening migration untuk POS core. Jalankan setelah migration 008.

Setelah migration diterapkan, lakukan smoke test minimal:

1. Open shift.
2. Close shift dengan cash = opening cash.
3. Open shift kedua.
4. Checkout cash.
5. Ulangi request checkout dengan idempotency key yang sama — harus tetap satu transaksi.
6. Simpan Bill Ditahan.
7. Coba close shift — harus ditolak dengan pesan Bill Ditahan masih ada.
8. Bayar Bill Ditahan.
9. Close shift.
10. Simulasikan dua request open shift bersamaan — hanya satu yang boleh berhasil.
11. Simulasikan checkout dan close shift bersamaan — transaksi tidak boleh masuk ke shift yang sudah closed.
