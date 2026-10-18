# HERMES POS Reusable Components V2

## Scope
Refactor PaymentScreen without changing transaction/payment/printer business logic.

## New reusable components
- `src/components/payment/PaymentMethodCard.tsx`
- `src/components/payment/CashPaymentPanel.tsx`
- `src/components/payment/QrisPaymentPanel.tsx`
- `src/components/payment/ReceiptPreview.tsx`

## PaymentScreen
PaymentScreen now keeps orchestration/business logic while delegating repeated UI blocks to reusable components.

Preserved:
- checkout payload
- idempotency key generation
- split/parent transaction support
- existing transaction support
- cart clearing behavior
- printer call and error handling
- payment validation
- cash/change calculation

## StyleSheet
Only `ReceiptPreview.tsx` intentionally retains `StyleSheet` because its thermal-receipt-like preview uses precise typography and line layout. PaymentScreen itself no longer imports or uses StyleSheet.
