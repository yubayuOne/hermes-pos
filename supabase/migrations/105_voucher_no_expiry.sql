-- 105: a voucher can run without an end date ("Tidak dibatasi"), as a quota can already be unlimited (owner's request, 7 Nov 2026).
-- A null expires_on is not expired: voucher_status, the POS voucher check (032) and the POS list (044) already compare with null-safe logic.

alter table public.vouchers alter column expires_on drop not null;

-- Same as 031, except a null end date is allowed; a date that is set may still not be before today.
create or replace function public.owner_save_voucher(
  p_id uuid, p_code text, p_scope text, p_discount_type text, p_value numeric, p_min_spend numeric,
  p_quota integer, p_expires_on date, p_product_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_business uuid := public._031_owner_writable();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_today date;
  v_id uuid;
  v_ids uuid[] := coalesce(p_product_ids, '{}');
begin
  select (now() at time zone timezone)::date into v_today from public.businesses where id = v_business;
  if v_code !~ '^[A-Z0-9]{4,12}$' then raise exception 'Kode voucher 4 sampai 12 huruf atau angka, tanpa spasi.' using errcode = '22023'; end if;
  if p_scope not in ('bill','products') then raise exception 'Pilih berlaku untuk seluruh bill atau produk tertentu.' using errcode = '22023'; end if;
  if p_discount_type = 'percent' and (p_value is null or p_value < 1 or p_value > 100) then raise exception 'Potongan persen harus 1 sampai 100.' using errcode = '22023'; end if;
  if p_discount_type = 'amount' and (p_value is null or p_value < 1000) then raise exception 'Potongan nominal minimal Rp1.000.' using errcode = '22023'; end if;
  if p_discount_type not in ('percent','amount') then raise exception 'Pilih jenis potongan.' using errcode = '22023'; end if;
  if coalesce(p_min_spend, 0) < 0 then raise exception 'Minimal belanja tidak boleh negatif.' using errcode = '22023'; end if;
  if p_quota is not null and p_quota < 1 then raise exception 'Kuota minimal 1, atau kosongkan untuk tanpa batas.' using errcode = '22023'; end if;
  if p_expires_on is not null and p_expires_on < v_today then raise exception 'Tanggal berakhir tidak boleh sebelum hari ini.' using errcode = '22023'; end if;
  if p_scope = 'products' then
    if cardinality(v_ids) = 0 then raise exception 'Pilih minimal satu produk.' using errcode = '22023'; end if;
    if exists (select 1 from unnest(v_ids) pid where not exists (
        select 1 from public.products p join public.outlets o on o.id = p.outlet_id where p.id = pid and o.business_id = v_business)) then
      raise exception 'Produk tidak ditemukan.' using errcode = '22023';
    end if;
  end if;
  if exists (select 1 from public.vouchers where business_id = v_business and code = v_code and id is distinct from p_id) then
    raise exception 'Kode voucher sudah dipakai. Pakai kode lain.' using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.vouchers(business_id, code, scope, discount_type, value, min_spend, quota, expires_on)
    values (v_business, v_code, p_scope, p_discount_type, round(p_value, 2), round(coalesce(p_min_spend, 0)), p_quota, p_expires_on)
    returning id into v_id;
  else
    update public.vouchers set code = v_code, scope = p_scope, discount_type = p_discount_type, value = round(p_value, 2),
      min_spend = round(coalesce(p_min_spend, 0)), quota = p_quota, expires_on = p_expires_on
    where id = p_id and business_id = v_business returning id into v_id;
    if v_id is null then raise exception 'Voucher tidak ditemukan.' using errcode = 'P0002'; end if;
    delete from public.voucher_products where voucher_id = v_id;
  end if;
  if p_scope = 'products' then
    insert into public.voucher_products(voucher_id, product_id) select v_id, x from (select distinct unnest(v_ids) x) s;
  end if;
  return v_id;
end $$;
revoke all on function public.owner_save_voucher(uuid, text, text, text, numeric, numeric, integer, date, uuid[]) from public, anon;
grant execute on function public.owner_save_voucher(uuid, text, text, text, numeric, numeric, integer, date, uuid[]) to authenticated;
