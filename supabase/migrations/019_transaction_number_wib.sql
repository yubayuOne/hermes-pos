-- KASBOX 019: tanggal pada nomor transaksi mengikuti Asia/Jakarta.
-- Sebelumnya memakai now() (UTC): transaksi pukul 00:00-07:00 WIB bernomor tanggal kemarin,
-- tidak konsisten dengan business_date shift yang sudah memakai Asia/Jakarta (migrasi 006).
create or replace function public.next_transaction_number() returns text
language plpgsql as $$
begin
  return '#KBX-' || to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD') || '-' || lpad(nextval('public.kasbox_transaction_seq')::text,5,'0');
end $$;
