-- Memasang fungsi cleanup_temporary_products yang hilang (isi sama dengan migrasi 021, tanpa jadwal cron).
-- Dipakai oleh create_temporary_product_with_id (migrasi 050). Aman dijalankan ulang (create or replace).
-- Jalankan di SQL Editor Supabase (role postgres/admin).

create or replace function public.cleanup_temporary_products(
  p_outlet_id uuid default null,
  p_older_than interval default interval '2 days'
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  n integer;
begin
  delete from public.products p
  where p.is_temporary
    and (p_outlet_id is null or p.outlet_id = p_outlet_id)
    and p.created_at < now() - p_older_than
    and not exists (select 1 from public.transaction_items ti where ti.product_id = p.id);
  get diagnostics n = row_count;
  return n;
end $$;

-- Fungsi internal: hanya dipanggil oleh fungsi lain dan pg_cron, tidak oleh aplikasi.
revoke execute on function public.cleanup_temporary_products(uuid, interval) from public, anon, authenticated;
