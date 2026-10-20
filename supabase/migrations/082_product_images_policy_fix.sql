-- Fixes the product-images policy of 080, the same bug 036 fixed for outlet logos: inside the subquery, a bare `name`
-- reads as outlets.name (the outlet's name), not the file path, so every upload was refused with "new row violates
-- row-level security policy". Use objects.name.
-- The local test database has no storage schema, so this is skipped there.

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not found, product-images policy skipped';
    return;
  end if;

  execute 'drop policy if exists "owner manages product images" on storage.objects';
  execute $p$
    create policy "owner manages product images" on storage.objects for all to authenticated
    using (
      bucket_id = 'product-images'
      and exists (
        select 1 from public.business_members bm join public.outlets o on o.business_id = bm.business_id
        where bm.auth_user_id = auth.uid() and bm.role = 'owner'
          and bm.business_id::text = (storage.foldername(objects.name))[1]
          and o.id::text = (storage.foldername(objects.name))[2]
      )
    )
    with check (
      bucket_id = 'product-images'
      and exists (
        select 1 from public.business_members bm join public.outlets o on o.business_id = bm.business_id
        where bm.auth_user_id = auth.uid() and bm.role = 'owner'
          and bm.business_id::text = (storage.foldername(objects.name))[1]
          and o.id::text = (storage.foldername(objects.name))[2]
      )
    )
  $p$;
end $outer$;
