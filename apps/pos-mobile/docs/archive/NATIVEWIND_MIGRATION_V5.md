# NativeWind Migration V5 — Pesanan

## Scope
Migrates the cashier **Pesanan / Transactions** screen to NativeWind while preserving existing transaction and held-bill behavior.

## Migrated UI
- Pesanan header
- Search field
- Bill Selesai / Bill Ditahan segmented filter
- Result counts
- Transaction / held-bill cards
- Loading state
- Empty state
- Press feedback
- Held-bill opening/loading state

## Preserved behavior
- `fetchTransactions(shift.id)` remains unchanged.
- Completed and held filters remain unchanged.
- Search continues to match bill number, customer name, and table.
- Only held bills are actionable for recall.
- `onHeldBill` callback remains unchanged.
- No database schema or transaction logic changes were introduced.

## NativeWind note
The receipt/transaction data model and service layer were not modified. This step is UI-only.
