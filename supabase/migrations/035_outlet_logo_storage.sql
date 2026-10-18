-- 035: tempat unggah logo outlet (Supabase Storage).
-- * Bucket publik `outlet-logos`: POS memuat logo lewat URL publik tanpa sesi. Logo bukan data rahasia.
-- * Path wajib `{business_id}/{outlet_id}/{nama file}`. Pemilik hanya bisa menulis, mengganti, dan menghapus file di
--   folder bisnisnya sendiri dan outlet miliknya. Membaca daftar file juga dibatasi ke folder itu.
-- * Maks 256 KB: backoffice wajib mengecilkan logo di peramban dulu (maks 256 px, WebP), hasilnya biasanya < 40 KB.
--   Batas ini menolak file asli yang lolos tanpa kompresi. Hanya PNG, JPEG, WebP. SVG ditolak: SVG yang dibuka langsung dari domain storage bisa menjalankan skrip,
--   dan POS (React Native Image) tidak menampilkannya.
-- * Setelah unggah, backoffice menyimpan URL publiknya lewat owner_set_outlet_logo (034).
-- Database tes lokal tidak punya skema storage, jadi bagian ini dilewati di sana.

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not found, outlet-logos bucket skipped';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('outlet-logos', 'outlet-logos', true, 262144, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "owner manages outlet logos" on storage.objects';
  execute $p$
    create policy "owner manages outlet logos" on storage.objects for all to authenticated
    using (
      bucket_id = 'outlet-logos'
      and exists (
        select 1 from public.business_members bm join public.outlets o on o.business_id = bm.business_id
        where bm.auth_user_id = auth.uid() and bm.role = 'owner'
          and bm.business_id::text = (storage.foldername(name))[1]
          and o.id::text = (storage.foldername(name))[2]
      )
    )
    with check (
      bucket_id = 'outlet-logos'
      and exists (
        select 1 from public.business_members bm join public.outlets o on o.business_id = bm.business_id
        where bm.auth_user_id = auth.uid() and bm.role = 'owner'
          and bm.business_id::text = (storage.foldername(name))[1]
          and o.id::text = (storage.foldername(name))[2]
      )
    )
  $p$;
end $outer$;
