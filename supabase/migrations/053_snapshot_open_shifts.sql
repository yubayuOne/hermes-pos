-- 053: the reference snapshot (052) also carries the open shift of each of the outlet's cashiers.
-- Without it a phone that never loaded a cashier's shift thinks offline that none is open, lets the cashier open a
-- second one, and the server refuses that opening later ("Masih ada shift aktif"). Same function, one more key.

create or replace function public.pos_reference_snapshot(p_outlet_id uuid, p_version text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cashier uuid;
  v jsonb;
  v_version text;
begin
  select cs.cashier_id into v_cashier
  from public.cashier_sessions cs
  where cs.auth_user_id = auth.uid() and cs.outlet_id = p_outlet_id and cs.is_active
  limit 1;
  if v_cashier is null then raise exception 'Outlet tidak ditemukan'; end if;

  v := jsonb_build_object(
    'cashiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'cashier_id', cs.cashier_id, 'cashier_name', cs.cashier_name, 'outlet_id', cs.outlet_id,
        'outlet_name', coalesce(o.name, cs.outlet_name), 'outlet_phone', o.phone, 'outlet_logo_url', o.logo_url,
        'outlet_logo_print_url', o.logo_print_url, 'outlet_address', o.address,
        'outlet_receipt_header', o.receipt_header, 'outlet_receipt_footer', o.receipt_footer,
        'terminal_name', cs.terminal_name, 'has_pin', cs.pin_hash is not null, 'pin_hash', cs.pin_hash
      ) order by lower(cs.cashier_name))
      from public.cashier_sessions cs
      left join public.outlets o on o.id = cs.outlet_id
      where cs.auth_user_id = auth.uid() and cs.outlet_id = p_outlet_id and cs.is_active
    ), '[]'::jsonb),
    -- shortcut: the whole menu each time stock changes; fine for a few hundred items, upgrade to updated_at rows when larger.
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'category_id', p.category_id, 'name', p.name, 'hpp', p.hpp, 'selling_price', p.selling_price,
        'stock', p.stock, 'track_stock', p.track_stock, 'image_url', p.image_url, 'station', p.station
      ) order by p.name, p.id)
      from public.products p
      where p.outlet_id = p_outlet_id and p.is_active and not p.is_temporary
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name, c.id)
      from public.categories c
      where c.outlet_id = p_outlet_id and c.is_active
    ), '[]'::jsonb),
    'vouchers', public.pos_list_vouchers(v_cashier, p_outlet_id),
    -- The open shift of each cashier of the outlet (at most one each), in the shape the app reads from `shifts`.
    'open_shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'cashier_id', s.cashier_id, 'business_date', s.business_date, 'shift_number', s.shift_number,
        'opened_at', s.opened_at, 'opening_cash', s.opening_cash, 'status', s.status, 'device_id', s.device_id
      ) order by s.opened_at, s.id)
      from public.shifts s
      where s.outlet_id = p_outlet_id and s.status = 'open'
        and s.cashier_id in (select cs.cashier_id from public.cashier_sessions cs where cs.auth_user_id = auth.uid() and cs.outlet_id = p_outlet_id)
    ), '[]'::jsonb),
    'business_date', (now() at time zone 'Asia/Jakarta')::date
  );

  v_version := md5(v::text);
  if p_version is not null and p_version = v_version then
    return jsonb_build_object('version', v_version, 'unchanged', true);
  end if;
  return v || jsonb_build_object('version', v_version);
end;
$$;
revoke all on function public.pos_reference_snapshot(uuid, text) from public, anon;
grant execute on function public.pos_reference_snapshot(uuid, text) to authenticated;
