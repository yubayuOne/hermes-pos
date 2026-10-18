-- 038: nama produk menjadi HERMES POS (keputusan pemilik, 15 Okt 2026). Objek database yang masih bernama KASBOX diganti.
-- * Sequence nomor transaksi: kasbox_transaction_seq -> hermespos_transaction_seq. Rename menjaga nilai berjalan, jadi
--   nomor urut tidak mulai dari 1 lagi.
-- * Bill baru bernomor #HPOS-YYYYMMDD-NNNNN. Bill lama tetap #KBX-… (nomor yang sudah tercetak tidak diubah).
-- * Jadwal pg_cron kasbox-cleanup-temporary-products -> hermes-pos-cleanup-temporary-products (jam tetap).
-- Migrasi 001 sampai 037 tidak diubah, jadi nama lama masih ada di komentar dan isi file itu.

do $$
begin
  if exists (select 1 from pg_class where relkind = 'S' and relname = 'kasbox_transaction_seq' and relnamespace = 'public'::regnamespace) then
    alter sequence public.kasbox_transaction_seq rename to hermespos_transaction_seq;
  else
    create sequence if not exists public.hermespos_transaction_seq;
  end if;
end $$;

create or replace function public.next_transaction_number() returns text
language plpgsql as $$
begin
  return '#HPOS-' || to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD') || '-' || lpad(nextval('public.hermespos_transaction_seq')::text,5,'0');
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'kasbox-cleanup-temporary-products') then
      perform cron.unschedule('kasbox-cleanup-temporary-products');
    end if;
    perform cron.schedule('hermes-pos-cleanup-temporary-products', '0 20 * * *', 'select public.cleanup_temporary_products(null)');
  end if;
end $$;
