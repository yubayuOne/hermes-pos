-- 036: perbaiki policy logo outlet (035). Di dalam subquery, `name` tanpa nama tabel terbaca sebagai outlets.name
-- (nama outlet), bukan path file, sehingga setiap unggah, list, dan hapus ditolak RLS. Pakai objects.name.
-- Database tes lokal tidak punya skema storage, jadi bagian ini dilewati di sana.

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not found, outlet-logos policy skipped';
    return;
  end if;

  execute 'drop policy if exists "owner manages outlet logos" on storage.objects';
  execute $p$
    create policy "owner manages outlet logos" on storage.objects for all to authenticated
    using (
      bucket_id = 'outlet-logos'
      and exists (
        select 1 from public.business_members bm join public.outlets o on o.business_id = bm.business_id
        where bm.auth_user_id = auth.uid() and bm.role = 'owner'
          and bm.business_id::text = (storage.foldername(objects.name))[1]
          and o.id::text = (storage.foldername(objects.name))[2]
      )
    )
    with check (
      bucket_id = 'outlet-logos'
      and exists (
        select 1 from public.business_members bm join public.outlets o on o.business_id = bm.business_id
        where bm.auth_user_id = auth.uid() and bm.role = 'owner'
          and bm.business_id::text = (storage.foldername(objects.name))[1]
          and o.id::text = (storage.foldername(objects.name))[2]
      )
    )
  $p$;
end $outer$;
