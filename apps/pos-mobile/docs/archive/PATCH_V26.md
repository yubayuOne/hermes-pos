
# PATCH V26 – Repository Analytics

## File berubah
- src/services/transaction/repository.ts
- src/types/domain.ts

## Perubahan
- `TransactionSummary` sekarang memiliki `items[]`.
- `fetchTransactions()` ikut mengambil `products(name, station)` dari Supabase.
- Bill Held tetap mengembalikan item yang tersisa setelah Split Bill.
- Dashboard sekarang bisa menghitung Top 5 Menu, Kitchen vs Bar, dan Insight tanpa query tambahan.
