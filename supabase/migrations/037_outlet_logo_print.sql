-- 037: logo outlet ikut tercetak di struk kertas.
-- * Backoffice membuat versi cetak saat unggah: perintah raster ESC/POS (GS v 0) hitam-putih, lebar maks 256 titik,
--   siap dikirim apa adanya ke printer. POS tidak perlu membaca gambar; cukup unduh file ini dan sisipkan.
-- * outlets.logo_print_url: URL file cetak di bucket outlet-logos. Null = struk tanpa logo.
-- * Bucket outlet-logos ikut menerima application/octet-stream (file cetak).
-- * owner_set_outlet_logo dapat p_print_url (opsional). Menghapus logo ('' / null) juga menghapus versi cetak.
-- * list_device_cashiers mengembalikan outlet_logo_print_url.

alter table public.outlets add column if not exists logo_print_url text;

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema not found, outlet-logos bucket skipped';
    return;
  end if;
  update storage.buckets
     set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream']
   where id = 'outlet-logos';
end $outer$;

drop function if exists public.owner_set_outlet_logo(uuid, text);
create function public.owner_set_outlet_logo(p_outlet_id uuid, p_logo_url text, p_print_url text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_url text := nullif(btrim(coalesce(p_logo_url, '')), '');
  v_print text := nullif(btrim(coalesce(p_print_url, '')), '');
begin
  if not public.subscription_active(b) then perform public.raise_expired('mengubah logo outlet'); end if;
  if v_url is null then v_print := null; end if;
  if (v_url is not null and (v_url !~* '^https://[^\s]+$' or char_length(v_url) > 1000))
     or (v_print is not null and (v_print !~* '^https://[^\s]+$' or char_length(v_print) > 1000)) then
    raise exception 'Alamat logo harus https dan maksimal 1000 karakter.' using errcode = '22023';
  end if;
  update public.outlets set logo_url = v_url, logo_print_url = v_print where id = p_outlet_id and business_id = b;
  if not found then raise exception 'Outlet tidak ditemukan'; end if;
end $$;
revoke all on function public.owner_set_outlet_logo(uuid, text, text) from public, anon;
grant execute on function public.owner_set_outlet_logo(uuid, text, text) to authenticated;

drop function if exists public.list_device_cashiers();
create function public.list_device_cashiers()
returns table(
  cashier_id uuid, cashier_name text, outlet_id uuid, outlet_name text,
  outlet_phone text, outlet_logo_url text, terminal_name text, has_pin boolean, pin_locked_until timestamptz,
  outlet_logo_print_url text
)
language sql stable security definer set search_path = public as $$
  select cs.cashier_id, cs.cashier_name, cs.outlet_id, coalesce(o.name, cs.outlet_name),
         o.phone, o.logo_url, cs.terminal_name, cs.pin_hash is not null,
         case when cs.pin_locked_until > now() then cs.pin_locked_until end,
         o.logo_print_url
  from public.cashier_sessions cs
  left join public.outlets o on o.id = cs.outlet_id
  where cs.auth_user_id = auth.uid() and cs.is_active
  order by lower(cs.cashier_name);
$$;
revoke all on function public.list_device_cashiers() from public, anon;
grant execute on function public.list_device_cashiers() to authenticated;
