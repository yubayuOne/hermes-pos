# HERMES POS — Reusable Components Refactor V1

## Scope

Refactor focused on repeated UI patterns and removal of unnecessary `StyleSheet` usage from catalog management screens and `App.tsx`.

## New reusable components

- `src/components/common/FormField.tsx`
- `src/components/common/IconButton.tsx`
- `src/components/common/EmptyState.tsx`
- `src/components/common/ManagementListRow.tsx`
- `src/components/common/SearchInput.tsx`

## Migrated screens

- `src/screens/settings/CategoriesScreen.tsx`
- `src/screens/settings/ProductsScreen.tsx`
- `App.tsx`

## Reuse improvements

- Product and category management rows now share `ManagementListRow`.
- Text input labels and inputs now share `FormField`.
- Empty/loading states now share `EmptyState`.
- Edit/delete icon actions now share `IconButton`.
- Product search now uses `SearchInput`.
- Product money parsing/formatting reuses `src/utils/money.ts`.

## StyleSheet status

After this refactor, only `src/screens/cashier/PaymentScreen.tsx` still contains `StyleSheet.create()`.

The receipt preview portion of PaymentScreen is intentionally left for a separate refactor because its layout is tightly coupled to receipt/print presentation.

## Preserved

No database schema, service, transaction, payment, shift, printer, routing, or business logic was changed.
