# HERMES POS Architecture

## Prinsip

1. Cashier-only: terminal tidak memiliki fitur manajemen master bisnis.
2. Database adalah source of truth.
3. UI tidak boleh melakukan write kritis langsung ke tabel transaksi.
4. Checkout dilakukan atomic di PostgreSQL.
5. Read-heavy catalog boleh memakai local cache.
6. Hardware diisolasi melalui adapter.
7. Domain logic dipisah dari presentational component.

## Layer

- `screens/`: orchestration UI per layar.
- `components/`: komponen reusable.
- `store/`: state sesi, katalog, shift, cart.
- `services/transaction/`: operasi domain terhadap Supabase.
- `services/cache/`: cache non-authoritative.
- `services/printer/`: abstraction dan receipt formatter.
- `utils/`: pure functions untuk money/cart.
- `types/`: domain contracts.
- `supabase/migrations/`: schema, constraints, RLS, RPC.

## Critical invariants

- Satu shift open per cashier.
- Checkout hanya dari shift open milik cashier yang login.
- Product row di-lock saat checkout.
- Stock tidak boleh negatif.
- Cash payment harus cukup.
- Payment unik per transaction.
- Idempotency key unik per cashier.
- Product/category write tidak diberikan kepada terminal.

## Empty/Zero Data Rendering

Presentation components are not conditional on the existence of business data. They render their structural sections first and bind values to zero/empty states when the query returns no rows. This keeps the terminal predictable for a newly provisioned outlet and matches the supplied HermesPos mobile design reference.
