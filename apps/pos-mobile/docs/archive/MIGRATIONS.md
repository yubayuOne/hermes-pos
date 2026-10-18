# Migration Guide

## Fresh project

1. Buat project Supabase.
2. Aktifkan Auth sesuai metode login yang dipilih.
3. Jalankan `supabase/migrations/001_initial.sql`.
4. Buat user kasir di Auth.
5. Buat outlet.
6. Provision `cashier_sessions` melalui backend/aplikasi Owner/Manager.
7. Isi categories/products melalui aplikasi Owner/Manager.
8. Isi `.env` HERMES POS.

## Deployment

Gunakan migration file sebagai source-controlled database schema. Jangan mengedit database production secara manual tanpa memasukkan perubahan kembali sebagai migration baru.

## Future migrations

Nomori migration berikutnya secara berurutan, misalnya:

```text
002_add_x.sql
003_add_y.sql
```

Jangan mengubah migration production yang sudah pernah dijalankan; buat migration baru untuk perubahan schema.


## 003_receipt_stations.sql

Adds product Kitchen/Bar station and outlet receipt metadata (phone/logo). Run after `002_catalog_crud.sql`.

## 004_split_bill.sql

Adds the Split Bill checkout flow using `transactions.parent_transaction_id`. The parent split transaction does not reserve or deduct stock; each paid child bill performs the stock deduction and creates its own payment/receipt transaction.

Run after `003_receipt_stations.sql` on existing databases.


## 006_shift_business_date.sql

Adds `business_date` and `shift_number` to shifts. The business date uses `Asia/Jakarta` and is fixed when the shift is opened. Crossing midnight does not move an active shift to the next day; transactions remain attached to that active shift. When the next business date opens its first shift, numbering starts again at Shift 1.

Run after `005_split_bill_iterative.sql`.

## 007_shift_close_fix.sql

Fixes the `close_shift` RPC so closing a shift no longer fails with the PostgreSQL `column reference "variance" is ambiguous` error. The calculation and Business Date rules remain unchanged.

Run after `006_shift_business_date.sql`.

## 008_shift_close_unambiguous.sql

Definitive fix for the `close_shift` RPC. The existing two-argument function is dropped and recreated with uniquely named PL/pgSQL variables (`v_expected_cash`, `v_variance_amount`) so PostgreSQL cannot confuse local variables with `shifts` columns.

Run this migration after 007. If 007 was not applied yet, 008 can still be applied directly after 006 because it replaces the same `close_shift(uuid,numeric)` function.
