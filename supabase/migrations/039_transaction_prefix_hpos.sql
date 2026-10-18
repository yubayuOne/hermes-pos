-- 039: awalan nomor bill baru tetap #HPOS- (keputusan pemilik, 15 Okt 2026). Sama dengan 038; file ini ada untuk database
-- yang sempat menjalankan versi 039 sebelumnya (#HMS-). Aman dijalankan ulang. Sequence dan urutan nomor tetap.
create or replace function public.next_transaction_number() returns text
language plpgsql as $$
begin
  return '#HPOS-' || to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD') || '-' || lpad(nextval('public.hermespos_transaction_seq')::text,5,'0');
end $$;
