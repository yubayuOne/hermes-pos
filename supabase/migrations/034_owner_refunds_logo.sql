-- 034: backoffice ikut refund (033) + logo outlet.
-- * owner_sales_summary: refund dikurangi pada tanggal refund, outlet refund, dan kasir yang melakukan refund (sama dengan
--   laporan shift POS). Laba = penjualan bersih - HPP; HPP item yang dikembalikan ke stok (restock) ikut dikeluarkan,
--   item yang tidak dikembalikan (makanan sudah dimasak) tetap jadi biaya. Grafik per jam dan menu terlaris tetap penjualan.
-- * owner_list_bills: + refundedTotal. owner_get_bill_items: + itemId, refundedQty.
-- * owner_list_bill_refunds: rincian refund satu bill.
-- * owner_set_outlet_logo: satu-satunya jalan menulis outlets.logo_url dari backoffice.

-- ---------------------------------------------------------------- 0. restock hanya untuk produk yang dilacak
-- 033 hanya menambah stok produk track_stock, tapi tetap menyimpan restock = true dari permintaan. Laba di bawah memakai
-- kolom ini, jadi nilainya harus sama dengan yang benar-benar terjadi pada stok.
create or replace function public.trg_refund_item_restock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.restock := new.restock and coalesce((
    select p.track_stock from public.transaction_items ti join public.products p on p.id = ti.product_id where ti.id = new.transaction_item_id
  ), false);
  return new;
end $$;
drop trigger if exists refund_item_restock on public.transaction_refund_items;
create trigger refund_item_restock before insert on public.transaction_refund_items
for each row execute function public.trg_refund_item_restock();

update public.transaction_refund_items ri set restock = false
from public.transaction_items ti join public.products p on p.id = ti.product_id
where ti.id = ri.transaction_item_id and ri.restock and not p.track_stock;

-- ---------------------------------------------------------------- 1. ringkasan penjualan pemilik
create or replace function public.owner_sales_summary(
  p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); result jsonb;
begin
  if p_outlet_id is not null and not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_to <= p_from or p_prev_to <= p_prev_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal terlalu panjang'; end if;

  with scope as (
    select o.id, o.name from public.outlets o where o.business_id = b and (p_outlet_id is null or o.id = p_outlet_id)
  ),
  tx as (
    select t.id, t.outlet_id, t.cashier_id, t.total, t.total_hpp, t.payment_method, t.created_at, t.item_discount, t.bill_discount
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'completed' and t.created_at >= p_from and t.created_at < p_to
  ),
  rf as (
    select r.id, r.outlet_id, r.cashier_id, r.method, r.amount, r.created_at
    from public.transaction_refunds r join scope s on s.id = r.outlet_id
    where r.created_at >= p_from and r.created_at < p_to
  ),
  totals as (
    select count(*)::int as cnt,
           coalesce(sum(total), 0) as sales,
           coalesce(sum(total_hpp), 0) as hpp,
           coalesce(sum(total) filter (where payment_method = 'cash'), 0) as cash,
           coalesce(sum(total) filter (where payment_method = 'qris'), 0) as qris,
           coalesce(sum(item_discount + bill_discount), 0) as discount
    from tx
  ),
  rtot as (
    select count(*)::int as cnt,
           coalesce(sum(amount), 0) as total,
           coalesce(sum(amount) filter (where method = 'cash'), 0) as cash,
           coalesce(sum(amount) filter (where method = 'qris'), 0) as qris,
           coalesce((select sum(ri.hpp_amount) from public.transaction_refund_items ri join rf on rf.id = ri.refund_id where ri.restock), 0) as restock_hpp
    from rf
  ),
  items as (
    select min(pr.name) as name, pr.station, sum(ti.quantity) as qty, sum(ti.net_subtotal) as subtotal
    from public.transaction_items ti
    join tx on tx.id = ti.transaction_id
    join public.products pr on pr.id = ti.product_id
    group by lower(btrim(pr.name)), pr.station
  ),
  prev as (
    select count(*)::int as cnt,
           coalesce(sum(t.total), 0) - coalesce((
             select sum(r.amount) from public.transaction_refunds r join scope s2 on s2.id = r.outlet_id
             where r.created_at >= p_prev_from and r.created_at < p_prev_to
           ), 0) as sales
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'completed' and t.created_at >= p_prev_from and t.created_at < p_prev_to
  ),
  voided as (
    select count(*)::int as cnt, coalesce(sum(t.total), 0) as total
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'voided' and t.created_at >= p_from and t.created_at < p_to
  ),
  -- Penjualan positif, refund negatif: satu sumber untuk harian, per outlet, dan per kasir.
  moves as (
    select outlet_id, cashier_id, created_at, total as amount, 1 as bill from tx
    union all
    select outlet_id, cashier_id, created_at, -amount, 0 from rf
  )
  select jsonb_build_object(
    'count', t.cnt,
    'sales', t.sales - r.total,
    'profit', (t.sales - r.total) - (t.hpp - r.restock_hpp),
    'cash', t.cash - r.cash,
    'qris', t.qris - r.qris,
    'refundCount', r.cnt,
    'refundTotal', r.total,
    'discountTotal', t.discount,
    'totalItems', coalesce((select sum(qty) from items), 0),
    'menuCount', (select count(*) from items),
    'previousSales', (select sales from prev),
    'previousCount', (select cnt from prev),
    'voidedCount', (select cnt from voided),
    'voidedTotal', (select total from voided),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'count', d.cnt, 'total', d.total) order by d.day)
      from (select (created_at at time zone 'Asia/Jakarta')::date as day, sum(bill)::int as cnt, sum(amount) as total from moves group by 1) d
    ), '[]'::jsonb),
    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'total', h.total) order by h.hour)
      from (select extract(hour from created_at at time zone 'Asia/Jakarta')::int as hour, sum(total) as total from tx group by 1) h
    ), '[]'::jsonb),
    'byOutlet', coalesce((
      select jsonb_agg(jsonb_build_object('outletId', s.id, 'name', s.name, 'count', coalesce(x.cnt, 0), 'sales', coalesce(x.sales, 0)) order by s.name)
      from scope s left join (select outlet_id, sum(bill)::int as cnt, sum(amount) as sales from moves group by 1) x on x.outlet_id = s.id
    ), '[]'::jsonb),
    'byCashier', coalesce((
      select jsonb_agg(jsonb_build_object('cashierId', x.cashier_id, 'name', coalesce(cs.cashier_name, 'Kasir dihapus'), 'count', x.cnt, 'sales', x.sales) order by x.sales desc)
      from (select cashier_id, sum(bill)::int as cnt, sum(amount) as sales from moves group by 1) x
      left join public.cashier_sessions cs on cs.cashier_id = x.cashier_id
    ), '[]'::jsonb),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'station', x.station, 'qty', x.qty, 'subtotal', x.subtotal) order by x.qty desc, x.subtotal desc, x.name)
      from (select * from items order by qty desc, subtotal desc, name limit 10) x
    ), '[]'::jsonb)
  ) into result
  from totals t, rtot r;
  return result;
end $$;

-- ---------------------------------------------------------------- 2. daftar bill pemilik + refundedTotal
create or replace function public.owner_list_bills(
  p_outlet_id uuid, p_from timestamptz, p_to timestamptz,
  p_status text default 'completed', p_search text default null, p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); lim integer; off integer; q text; result jsonb;
begin
  if p_outlet_id is not null and not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_to <= p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_status not in ('completed', 'held', 'voided', 'all') then raise exception 'Status bill tidak valid'; end if;
  lim := least(greatest(coalesce(p_limit, 50), 1), 200);
  off := greatest(coalesce(p_offset, 0), 0);
  q := nullif(btrim(coalesce(p_search, '')), '');

  with f as (
    select t.* from public.transactions t join public.outlets o on o.id = t.outlet_id
    where o.business_id = b and (p_outlet_id is null or o.id = p_outlet_id)
      and t.created_at >= p_from and t.created_at < p_to
      and t.status::text not in ('draft', 'split')
      and (p_status = 'all' or t.status::text = p_status)
      and (q is null or t.number ilike '%' || q || '%' or t.customer_name ilike '%' || q || '%' or t.table_number ilike '%' || q || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'number', r.number, 'status', r.status::text, 'total', r.total, 'paymentMethod', r.payment_method::text,
        'createdAt', r.created_at, 'customerName', r.customer_name, 'tableNumber', r.table_number,
        'outletId', r.outlet_id, 'outletName', r.outlet_name, 'cashierName', r.cashier_name,
        'voidReason', r.void_reason, 'discount', r.discount, 'refundedTotal', r.refunded_total) order by r.created_at desc, r.id)
      from (
        select f.id, f.number, f.status, f.total, f.payment_method, f.created_at, f.customer_name, f.table_number,
               f.outlet_id, o.name as outlet_name, coalesce(cs.cashier_name, 'Kasir dihapus') as cashier_name,
               f.void_reason, f.item_discount + f.bill_discount as discount, f.refunded_total
        from f
        join public.outlets o on o.id = f.outlet_id
        left join public.cashier_sessions cs on cs.cashier_id = f.cashier_id
        order by f.created_at desc, f.id
        limit lim offset off
      ) r
    ), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------- 3. item bill pemilik + itemId, refundedQty
create or replace function public.owner_get_bill_items(p_transaction_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.transactions%rowtype;
begin
  perform public.require_owner_business();
  select * into t from public.transactions where id = p_transaction_id;
  if not found or not public.is_owner_of_outlet(t.outlet_id) then raise exception 'Bill tidak ditemukan'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'itemId', ti.id,
      'productId', ti.product_id, 'productName', pr.name, 'station', pr.station,
      'quantity', ti.quantity, 'unitPrice', ti.selling_price_unit, 'subtotal', ti.subtotal,
      'discount', ti.discount_amount, 'note', ti.note,
      'refundedQty', coalesce((select sum(ri.quantity) from public.transaction_refund_items ri where ri.transaction_item_id = ti.id), 0)
    ) order by pr.name, ti.id)
    from public.transaction_items ti join public.products pr on pr.id = ti.product_id
    where ti.transaction_id = p_transaction_id
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 4. rincian refund satu bill
create or replace function public.owner_list_bill_refunds(p_transaction_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.transactions%rowtype;
begin
  perform public.require_owner_business();
  select * into t from public.transactions where id = p_transaction_id;
  if not found or not public.is_owner_of_outlet(t.outlet_id) then raise exception 'Bill tidak ditemukan'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'createdAt', r.created_at, 'cashierName', coalesce(cs.cashier_name, 'Kasir dihapus'),
      'method', r.method::text, 'amount', r.amount, 'reason', r.reason,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('productName', pr.name, 'quantity', ri.quantity, 'amount', ri.amount, 'restock', ri.restock) order by pr.name)
        from public.transaction_refund_items ri
        join public.transaction_items ti on ti.id = ri.transaction_item_id
        join public.products pr on pr.id = ti.product_id
        where ri.refund_id = r.id
      ), '[]'::jsonb)
    ) order by r.created_at)
    from public.transaction_refunds r
    left join lateral (select c.cashier_name from public.cashier_sessions c where c.cashier_id = r.cashier_id limit 1) cs on true
    where r.transaction_id = p_transaction_id
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 5. logo outlet
-- URL saja: unggah file diurus backoffice (Storage). null atau '' menghapus logo. Hanya https, supaya POS tidak memuat
-- gambar lewat http atau skema lain.
create or replace function public.owner_set_outlet_logo(p_outlet_id uuid, p_logo_url text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_url text := nullif(btrim(coalesce(p_logo_url, '')), '');
begin
  if not public.subscription_active(b) then perform public.raise_expired('mengubah logo outlet'); end if;
  if v_url is not null and (v_url !~* '^https://[^\s]+$' or char_length(v_url) > 1000) then
    raise exception 'Alamat logo harus https dan maksimal 1000 karakter.' using errcode = '22023';
  end if;
  update public.outlets set logo_url = v_url where id = p_outlet_id and business_id = b;
  if not found then raise exception 'Outlet tidak ditemukan'; end if;
end $$;

revoke all on function public.owner_list_bill_refunds(uuid) from public, anon;
revoke all on function public.owner_set_outlet_logo(uuid, text) from public, anon;
grant execute on function public.owner_list_bill_refunds(uuid) to authenticated;
grant execute on function public.owner_set_outlet_logo(uuid, text) to authenticated;
