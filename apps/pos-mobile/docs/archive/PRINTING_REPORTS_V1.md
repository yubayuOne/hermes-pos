# HERMES POS Printing & Reports V1

## Printing
- Held bill can be printed before payment.
- Payment confirmation no longer auto-prints.
- Customer, Kitchen, and Bar printing are separate actions.
- Reports use the existing Universal ESC/POS printer role `report`.
- Custom header/footer text is stored locally and reused by receipt/report printing.

## Reports
- Revenue, Cash, QRIS, Petty Cash, Expected Cash, Actual Cash, and variance.
- Expected Cash follows the requested formula: Petty Cash + Cash Revenue.
- Sold items are grouped dynamically by the product categories already configured in HERMES POS.
- Each category shows quantity and revenue, then product-level quantity and revenue.
- Report can be sent to a thermal printer.

## Notes
This patch does not add a new database table. It reads existing transactions, products, categories, and shift data.
