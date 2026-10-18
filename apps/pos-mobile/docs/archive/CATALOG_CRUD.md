# HERMES POS Catalog CRUD

## Location

Catalog management is available under:

- Setting → Kategori Produk
- Setting → Produk

## Category

Supported operations:

- Create category
- Edit category name and sort order
- Soft delete category

Deleting a category sets `is_active=false`. Product rows are not physically deleted and historical references remain intact.

## Product

Supported operations:

- Create product
- Edit name
- Change category
- Change HPP
- Change selling price
- Change stock
- Soft delete product

Deleted/inactive products no longer appear in the cashier catalog.

## Database

Migration:

`supabase/migrations/002_catalog_crud.sql`

Run the migration after `001_initial.sql`.

The app calls PostgreSQL RPC functions instead of direct client-side INSERT/UPDATE/DELETE. Each function validates the authenticated active cashier session and outlet.

## Cache

After any category/product mutation, the local catalog cache for the outlet is invalidated so the Kasir screen can fetch the updated catalog.

## Important

This changes the previous architectural decision that catalog writes were Owner/Manager-only. The current HERMES POS requirement explicitly enables catalog CRUD from Settings.
