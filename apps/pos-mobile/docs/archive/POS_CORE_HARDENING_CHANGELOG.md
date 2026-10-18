# POS Core Hardening — 2026-10-06

## Implemented

- Removed the misleading local-only `AppStore.closeShift()` operation.
- Dashboard Close Shift now calls the real `close_shift` RPC and only clears local state after database success.
- Dashboard Close Shift now requires physical cash input.
- Close Shift cannot be double-submitted while the request is running.
- Close Shift refuses to close a shift with active held bills.
- `open_shift` now serializes concurrent requests before checking the active-shift invariant.
- `complete_checkout` now serializes checkout against shift closure using `FOR UPDATE`.
- `save_held_bill` now serializes bill holding against shift closure.
- Checkout retry uses a stable idempotency key for the payment attempt.
- Failed/timeout checkout can be retried without intentionally creating a second transaction.
- Terminal reconciles its shift state from the database after a shift/payment state error.
- Transaction list loading no longer has an arbitrary 100-row cap; it paginates until the shift is exhausted.
- Backend errors are no longer silently converted into empty transaction lists.
- Added user-facing error mapping for common POS/domain failures.
- Fixed Dashboard Shift History so it actually renders shift data.
- Removed the non-functional Print action from Close Shift summary.
- Closing a shift from Shift Settings also clears terminal cart/split/held state after successful close.
- Dashboard peak-hour buckets now consider all 24 hours and use Asia/Jakarta time.

## Database migration

Apply:

```text
supabase/migrations/009_pos_core_integrity.sql
```

after migration 008.

## Important

The project archive intentionally excludes `.env.local`, `node_modules`, Android build caches, and Expo caches. Reinstall dependencies locally before building.

The source archive was checked for TypeScript/TSX syntax using the TypeScript parser. A full typecheck could not be completed in this environment because the supplied archive contains package metadata without the actual TypeScript declaration files in `node_modules`, and dependency installation timed out.

## v3 — Cash Ledger Core

- Added append-only `cash_ledger` for shift cash accounting.
- Opening cash creates a `shift_opening` ledger entry.
- Paid cash payments automatically create a `payment` ledger entry.
- Added `create_cash_movement` RPC for explicit cash in/out with mandatory reason.
- Added `get_shift_cash_summary` RPC.
- `close_shift` now derives expected cash from the ledger and still locks the shift row.
- Cash ledger is protected by RLS; cashier clients can only read their own active session's outlet ledger.
- Added Shift & Kas UI for cash in/out and recent manual movements.
- Added cash-ledger architecture documentation.


## v5 — Payment intent state hardening

- Fixed `AppStore` memoization so `activeHeldBillId` changes propagate immediately to consumers.
- Changed payment idempotency key lifecycle from input-change based to payment-intent based.
- A retry after a network timeout keeps the same key when the payment intent is unchanged.
- Changing items, payment method, received amount, customer, or split context invalidates the previous key.
- Added a final safety fallback before checkout so a missing key can never reach the RPC.
- Successful checkout clears the key and fingerprint; failed checkout preserves the key for safe retry.

## Migration 018
- Menu Sementara: kolom `products.is_temporary` + RPC `create_temporary_product` (tersembunyi dari katalog & Setting).
- Hapus Bill: RPC `delete_held_bill` membatalkan Bill Ditahan (status `cancelled`).
- Fitur Kas Masuk/Kas Keluar manual dihapus: RPC `create_cash_movement` di-drop. `cash_ledger` dan `get_shift_cash_summary` tetap ada untuk expected cash.
