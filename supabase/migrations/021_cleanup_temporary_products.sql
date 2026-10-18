-- KASBOX 021: pembersihan Menu Sementara.
-- Setiap menu sementara (migrasi 018) membuat satu baris di products. Baris yang tidak pernah
-- dipakai di transaksi/bill (mis. menu dibatalkan sebelum dibayar) akan menumpuk.
--
-- Aturan penghapusan (aman): hanya baris is_temporary = true, lebih tua dari p_older_than,
-- DAN tidak dipakai transaction_items mana pun (bill selesai, ditahan, split, maupun dibatalkan
-- tetap menyimpan riwayat sehingga produknya tidak ikut terhapus).
--
-- Dua lapis pemicu:
--   1) Oportunistik: create_temporary_product membersihkan outlet yang sama (murah, berindeks).
--   2) Terjadwal harian 03:00 WIB bila ekstensi pg_cron aktif (Supabase: Database > Extensions).

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

-- Fungsi internal: hanya dipanggil oleh fungsi lain / pg_cron, tidak oleh klien.
revoke execute on function public.cleanup_temporary_products(uuid, interval) from public, anon, authenticated;

create or replace function public.create_temporary_product(
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_name text,
  p_price numeric,
  p_station public.product_station default 'kitchen'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Nama menu sementara wajib diisi';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Harga menu sementara harus lebih dari nol';
  end if;

  -- Bersihkan sisa menu sementara lama milik outlet ini (tidak pernah dipakai di transaksi).
  perform public.cleanup_temporary_products(p_outlet_id);

  insert into public.products(
    outlet_id, category_id, name, hpp, selling_price, stock, station, is_active, is_temporary
  ) values (
    p_outlet_id, null, trim(p_name), 0, p_price, 999999, p_station, true, true
  )
  returning id into pid;

  return pid;
end;
$$;

revoke execute on function public.create_temporary_product(uuid, uuid, text, numeric, public.product_station) from public, anon;
grant execute on function public.create_temporary_product(uuid, uuid, text, numeric, public.product_station) to authenticated;

-- Jadwal harian (opsional): hanya bila pg_cron sudah diaktifkan. 20:00 UTC = 03:00 WIB.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.schedule('kasbox-cleanup-temporary-products', '0 20 * * *', 'select public.cleanup_temporary_products(null)')$cron$;
  end if;
end $$;
