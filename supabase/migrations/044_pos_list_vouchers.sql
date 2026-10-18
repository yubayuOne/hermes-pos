-- 044: kasir memilih voucher dari daftar, tidak mengetik kode (permintaan pemilik, 15 Okt 2026).
-- Hanya baca: voucher bisnis outlet ini yang masih bisa dipakai hari ini (aktif, belum berakhir, kuota masih ada),
-- bentuk sama dengan pos_check_voucher. Checkout tetap memeriksa ulang voucher lewat kodenya (032).

create or replace function public.pos_list_vouchers(p_cashier_id uuid, p_outlet_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);
  select (now() at time zone coalesce(b.timezone, 'Asia/Jakarta'))::date into v_today
  from public.outlets o join public.businesses b on b.id = o.business_id where o.id = p_outlet_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', v.code, 'scope', v.scope, 'discount_type', v.discount_type, 'value', v.value,
      'min_spend', v.min_spend, 'expires_on', v.expires_on,
      'product_ids', coalesce((select jsonb_agg(vp.product_id) from public.voucher_products vp where vp.voucher_id = v.id), '[]'::jsonb))
      order by v.expires_on, v.code)
    from public.vouchers v join public.outlets o on o.business_id = v.business_id
    where o.id = p_outlet_id and public.voucher_status(v, v_today) = 'active'
  ), '[]'::jsonb);
end $$;
revoke all on function public.pos_list_vouchers(uuid, uuid) from public, anon;
grant execute on function public.pos_list_vouchers(uuid, uuid) to authenticated;
