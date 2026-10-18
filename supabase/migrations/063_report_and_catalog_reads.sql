-- 063: two reads that did the same work twice (audit, 18 Oct 2026; follows 062). Read only.
-- * owner_report_page: the Laporan page in one call. It ran owner_report and owner_sales_summary over the same range;
--   the summary also summed every bill item (top products), the previous period and the hours, which the report never
--   shows. Now: owner_report plus only the sales figures the report uses (totals, cash / QRIS, void, refund, per day,
--   per outlet, per cashier), same rules as owner_sales_summary (045).
-- * pos_reference_snapshot: every phone asks each minute; the server built the whole menu as JSON and its md5 just to
--   answer "unchanged". The version now comes from a hash of each product's and category's (id, updated_at) (the
--   updated_at triggers of 001 catch every edit, stock included) plus the small parts (cashiers, vouchers, open shifts,
--   dates), so the menu is built only when something changed. A sum of row hashes does not depend on commit order, so
--   an edit committed late is still seen. Same content as 059; the version string format changes, so each phone loads
--   the snapshot once more after this migration.

-- ---------------------------------------------------------------- Laporan in one call
create or replace function public.owner_report_page(
  p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  -- Checks the outlet and the range.
  v_report jsonb := public.owner_report(p_outlet_id, p_from, p_to, p_prev_from, p_prev_to);
  v_sales jsonb;
begin
  with scope as (
    select o.id, o.name from public.outlets o where o.business_id = b and (p_outlet_id is null or o.id = p_outlet_id)
  ),
  tx as not materialized (
    select t.outlet_id, t.cashier_id, t.total, t.payment_method, t.created_at
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'completed' and t.created_at >= p_from and t.created_at < p_to
  ),
  rf as (
    select r.outlet_id, r.cashier_id, r.method, r.amount, r.created_at
    from public.transaction_refunds r join scope s on s.id = r.outlet_id
    where r.created_at >= p_from and r.created_at < p_to
  ),
  totals as (
    select count(*)::int as cnt, coalesce(sum(total), 0) as sales,
           coalesce(sum(total) filter (where payment_method = 'cash'), 0) as cash,
           coalesce(sum(total) filter (where payment_method = 'qris'), 0) as qris
    from tx
  ),
  rtot as (
    select count(*)::int as cnt, coalesce(sum(amount), 0) as total,
           coalesce(sum(amount) filter (where method = 'cash'), 0) as cash,
           coalesce(sum(amount) filter (where method = 'qris'), 0) as qris
    from rf
  ),
  voided as (
    select count(*)::int as cnt, coalesce(sum(t.total), 0) as total
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'voided' and t.created_at >= p_from and t.created_at < p_to
  ),
  -- Sales positive, refunds negative: one source for per day, per outlet and per cashier (as 045).
  moves as (
    select outlet_id, cashier_id, created_at, total as amount, 1 as bill from tx
    union all
    select outlet_id, cashier_id, created_at, -amount, 0 from rf
  )
  select jsonb_build_object(
    'count', t.cnt,
    'sales', t.sales - r.total,
    'cash', t.cash - r.cash,
    'qris', t.qris - r.qris,
    'refundCount', r.cnt,
    'refundTotal', r.total,
    'voidedCount', (select cnt from voided),
    'voidedTotal', (select total from voided),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'count', d.cnt, 'total', d.total) order by d.day)
      from (select (created_at at time zone 'Asia/Jakarta')::date as day, sum(bill)::int as cnt, sum(amount) as total from moves group by 1) d
    ), '[]'::jsonb),
    'byOutlet', coalesce((
      select jsonb_agg(jsonb_build_object('outletId', s.id, 'name', s.name, 'count', coalesce(x.cnt, 0), 'sales', coalesce(x.sales, 0)) order by s.name)
      from scope s left join (select outlet_id, sum(bill)::int as cnt, sum(amount) as sales from moves group by 1) x on x.outlet_id = s.id
    ), '[]'::jsonb),
    'byCashier', coalesce((
      select jsonb_agg(jsonb_build_object('cashierId', x.cashier_id, 'name', coalesce(cs.cashier_name, 'Kasir dihapus'), 'count', x.cnt, 'sales', x.sales) order by x.sales desc)
      from (select cashier_id, sum(bill)::int as cnt, sum(amount) as sales from moves group by 1) x
      left join lateral (select c.cashier_name from public.cashier_sessions c where c.cashier_id = x.cashier_id limit 1) cs on true
    ), '[]'::jsonb)
  ) into v_sales
  from totals t, rtot r;

  return v_report || jsonb_build_object('sales', v_sales);
end $$;
revoke all on function public.owner_report_page(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_report_page(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------- POS reference snapshot
create or replace function public.pos_reference_snapshot(p_outlet_id uuid, p_version text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cashier uuid;
  v_small jsonb;
  v_version text;
begin
  select cs.cashier_id into v_cashier
  from public.cashier_sessions cs
  where cs.auth_user_id = auth.uid() and cs.outlet_id = p_outlet_id and cs.is_active
  limit 1;
  if v_cashier is null then raise exception 'Outlet tidak ditemukan'; end if;

  -- The small parts, built in full each time (a few rows each); same shapes as 059.
  v_small := jsonb_build_object(
    'cashiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'cashier_id', cs.cashier_id, 'cashier_name', cs.cashier_name, 'outlet_id', cs.outlet_id,
        'outlet_name', coalesce(o.name, cs.outlet_name), 'outlet_phone', o.phone, 'outlet_logo_url', o.logo_url,
        'outlet_logo_print_url', o.logo_print_url, 'outlet_address', o.address,
        'outlet_receipt_header', o.receipt_header, 'outlet_receipt_footer', o.receipt_footer,
        'terminal_name', cs.terminal_name, 'has_pin', cs.pin_hash is not null
      ) order by lower(cs.cashier_name))
      from public.cashier_sessions cs
      left join public.outlets o on o.id = cs.outlet_id
      where cs.auth_user_id = auth.uid() and cs.outlet_id = p_outlet_id and cs.is_active
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

  -- Products and categories by row hash; every row of the outlet counts, so deactivating or deleting changes it too.
  v_version := md5(concat_ws('|',
    (select coalesce(sum(hashtextextended(p.id::text || p.updated_at::text, 0)::numeric), 0) || ':' || count(*)
       from public.products p where p.outlet_id = p_outlet_id),
    (select coalesce(sum(hashtextextended(c.id::text || c.updated_at::text, 0)::numeric), 0) || ':' || count(*)
       from public.categories c where c.outlet_id = p_outlet_id),
    v_small::text));
  if p_version is not null and p_version = v_version then
    return jsonb_build_object('version', v_version, 'unchanged', true);
  end if;

  return v_small || jsonb_build_object(
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
    'version', v_version
  );
end;
$$;
revoke all on function public.pos_reference_snapshot(uuid, text) from public, anon;
grant execute on function public.pos_reference_snapshot(uuid, text) to authenticated;
