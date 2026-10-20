-- Product photos for the cashier app's Foto view (owner's decision, 21 Oct 2026). The cashier app already shows
-- products.image_url; this lets the owner set it from the backoffice.
-- * Public bucket `product-images`: the POS loads photos by public URL and keeps them on the phone. Path
--   `{business_id}/{outlet_id}/{product_id}-{ms}.webp`; an owner writes only inside their own business and outlet.
-- * Max 100 KB, WebP or JPEG: the backoffice crops and shrinks every photo in the browser first (400 x 400 px), so this
--   limit only refuses an original that skipped that step.
-- The local test database has no storage schema, so the bucket part is skipped there.

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not found, product-images bucket skipped';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('product-images', 'product-images', true, 102400, array['image/webp', 'image/jpeg'])
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "owner manages product images" on storage.objects';
  execute $p$
    create policy "owner manages product images" on storage.objects for all to authenticated
    using (
      bucket_id = 'product-images'
      and exists (
        select 1 from public.business_members bm join public.outlets o on o.business_id = bm.business_id
        where bm.auth_user_id = auth.uid() and bm.role = 'owner'
          and bm.business_id::text = (storage.foldername(name))[1]
          and o.id::text = (storage.foldername(name))[2]
      )
    )
    with check (
      bucket_id = 'product-images'
      and exists (
        select 1 from public.business_members bm join public.outlets o on o.business_id = bm.business_id
        where bm.auth_user_id = auth.uid() and bm.role = 'owner'
          and bm.business_id::text = (storage.foldername(name))[1]
          and o.id::text = (storage.foldername(name))[2]
      )
    )
  $p$;
end $outer$;

-- Sets or clears (empty url) a product's photo. Same URL rule as the outlet logo (037).
create or replace function public.owner_set_product_image(p_product_id uuid, p_image_url text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_url text := nullif(btrim(coalesce(p_image_url, '')), '');
begin
  if not public.subscription_active(b) then perform public.raise_expired('mengubah foto produk'); end if;
  if v_url is not null and (v_url !~* '^https://[^\s]+$' or char_length(v_url) > 1000) then
    raise exception 'Alamat foto harus https dan maksimal 1000 karakter.' using errcode = '22023';
  end if;
  update public.products p set image_url = v_url
  from public.outlets o
  where p.id = p_product_id and o.id = p.outlet_id and o.business_id = b;
  if not found then raise exception 'Produk tidak ditemukan'; end if;
end $$;
revoke all on function public.owner_set_product_image(uuid, text) from public, anon;
grant execute on function public.owner_set_product_image(uuid, text) to authenticated;
