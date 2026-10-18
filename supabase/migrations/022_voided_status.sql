-- KASBOX 022: status untuk Batal Bill.
-- Dipisah dari migrasi lain karena nilai enum baru baru boleh DIPAKAI setelah transaksi yang
-- menambahkannya selesai (aturan PostgreSQL).
--   order_status   + 'voided'   : bill yang sudah dibayar lalu dibatalkan kasir
--   payment_status + 'refunded' : pembayaran bill tersebut dikembalikan ke pelanggan
alter type public.order_status add value if not exists 'voided';
alter type public.payment_status add value if not exists 'refunded';

alter table public.transactions
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;
