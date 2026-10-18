# NativeWind Migration V3 — Split Bill

## Scope

Migrated the Split Bill screen UI to NativeWind 4.2.7.

## Changed

- Split Bill bottom-sheet/modal shell
- Customer identity card
- Customer name input
- Table information
- Remaining/selected summary
- Item list cards
- Quantity stepper
- Loading state
- Empty/exhausted state
- Sticky Bill Split summary
- Sticky Lanjut Pembayaran button

## Preserved

- `startSplitFromHeld`
- `getRemainingSplitItems`
- Existing quantity allocation logic
- Existing customer/table flow
- Existing payment callback
- Existing Split Bill business rules
- Existing route and modal behavior

No database schema or transaction business logic was changed in this migration.
