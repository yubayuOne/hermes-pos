# HERMES POS Receipt Format

HERMES POS uses three logical receipt sections from one completed transaction.

## 1. Production summary

The preview/production output contains:

- Outlet logo
- Outlet name
- Outlet phone
- Detail Bill Customer
- Bill Kitchen
- Bill Bar

Kitchen contains only products with `station = kitchen`.
Bar contains only products with `station = bar`.

If a transaction has no Kitchen items, the Kitchen section is omitted.
If a transaction has no Bar items, the Bar section is omitted.

## 2. Customer Bill

The Customer Bill is a separate section in the same receipt data.

It contains **all transaction items**, regardless of station.

It also contains:

- Total
- Payment method
- Amount paid (cash)
- Change (cash)
- Thank-you message

The customer bill never calculates its total from Kitchen/Bar subtotals. It uses the completed transaction total.

## 3. Product station

Every product has:

- `kitchen`
- `bar`

The station is configured from:

`Setting → Produk → Tipe Menu`

Category remains independent from station:

- Category = cashier catalog grouping.
- Station = production/printing destination.

## 4. Database migration

Run:

`supabase/migrations/003_receipt_stations.sql`

after:

1. `001_initial.sql`
2. `002_catalog_crud.sql`

The migration adds:

- `products.station`
- `product_station` enum
- `outlets.phone`
- `outlets.logo_url`
- updated product CRUD RPC signatures

## 5. Printer abstraction

`ReceiptData` now contains:

- `items`
- `kitchenItems`
- `barItems`
- outlet metadata
- customer metadata
- payment metadata

The printer adapter can therefore route the same completed transaction to:

- Customer receipt printer
- Kitchen printer
- Bar printer

without changing checkout logic.
