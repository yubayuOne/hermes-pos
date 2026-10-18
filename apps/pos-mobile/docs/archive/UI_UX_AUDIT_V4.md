# HERMES POS UI/UX Refinement V4

First-pass cashier refinement focused on speed and clarity without changing transaction behavior.

## Changes
- Cashier header shows the active shift as a compact status badge.
- Shift-active messaging is compacted into an operational strip.
- Product search is visually primary and full-width; the unused barcode affordance is removed from this screen.
- Category chips remain compact and horizontally scrollable.
- Cart dock CTA now says `Lihat` because it opens the order sheet rather than immediately charging the customer.
- Cart sheet is slightly taller with a stronger total hierarchy and larger primary payment action.
- Existing Split Bill, Tahan Bill, and payment behavior is preserved.

## Deliberately unchanged
- Database schema and transaction flow.
- Product/catalog CRUD.
- Shift/business-date rules.
- Payment methods and receipt logic.
- Split Bill architecture.
