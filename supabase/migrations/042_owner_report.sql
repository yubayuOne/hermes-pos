-- 042: laporan pemilik di backoffice (PRD F6, DESIGN D5 dan F): laporan kinerja A4 seperti contoh ekspor.
-- Penjualan per hari, outlet, kasir, tunai/QRIS, void, dan refund tetap dari owner_sales_summary (034).
-- * Rentang memakai waktu, sama dengan owner_sales_summary. Shift dan pengeluaran masuk periode menurut waktu shift
--   dibuka, supaya ikut zona waktu bisnis (shifts.business_date selalu WIB).
-- * Laba rugi: penjualan kotor (sebelum diskon) - diskon dan voucher - refund = penjualan bersih; - HPP (tanpa barang
--   refund yang kembali ke stok) = laba kotor; - pengeluaran operasional disetujui = laba operasional.
--   Pengeluaran 'belanja' (bahan) tidak masuk laba rugi karena biayanya sudah ada di HPP; tampil di arus kas.
--   Pengeluaran yang belum dicek tidak dihitung, jumlahnya ditampilkan terpisah.
-- * Rekonsiliasi kas laci: hanya shift yang sudah ditutup, dari buku kas per jenis sumber.
-- * Kategori dan produk: penjualan setelah diskon item, sebelum refund (sama dengan menu terlaris di Ringkasan).
-- * Hanya baca. Tetap terbuka saat langganan berakhir (PRD G5). Aman dijalankan ulang: hanya fungsi.

create or replace function public.report_pnl(p_business uuid, p_outlet_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with scope as (
    select o.id from public.outlets o where o.business_id = p_business and (p_outlet_id is null or o.id = p_outlet_id)
  ), tx as (
    select coalesce(sum(t.total), 0) as sales, coalesce(sum(t.item_discount + t.bill_discount), 0) as discounts,
      coalesce(sum(t.total_hpp), 0) as hpp, count(*)::int as cnt
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'completed' and t.created_at >= p_from and t.created_at < p_to
  ), rf as (
    select coalesce(sum(r.amount), 0) as total,
      coalesce((select sum(ri.hpp_amount) from public.transaction_refund_items ri
        join public.transaction_refunds r2 on r2.id = ri.refund_id join scope s2 on s2.id = r2.outlet_id
        where ri.restock and r2.created_at >= p_from and r2.created_at < p_to), 0) as restock_hpp
    from public.transaction_refunds r join scope s on s.id = r.outlet_id
    where r.created_at >= p_from and r.created_at < p_to
  ), ex as (
    select coalesce(sum(i.amount) filter (where i.category = 'operasional'), 0) as opex,
      coalesce(sum(i.amount) filter (where i.category = 'belanja'), 0) as inventory
    from public.expenses e join scope s on s.id = e.outlet_id join public.shifts sh on sh.id = e.shift_id
    join public.expense_items i on i.expense_id = e.id
    where e.status = 'approved' and sh.opened_at >= p_from and sh.opened_at < p_to
  )
  select jsonb_build_object(
    'grossSales', tx.sales + tx.discounts, 'discounts', tx.discounts, 'refunds', rf.total, 'netSales', tx.sales - rf.total,
    'count', tx.cnt, 'hpp', tx.hpp - rf.restock_hpp, 'grossProfit', (tx.sales - rf.total) - (tx.hpp - rf.restock_hpp),
    'operatingExpenses', ex.opex, 'inventoryPurchases', ex.inventory,
    'operatingProfit', (tx.sales - rf.total) - (tx.hpp - rf.restock_hpp) - ex.opex)
  from tx, rf, ex
$$;
revoke all on function public.report_pnl(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.owner_report(
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
  sh as (
    select s.*, sc.name as outlet_name,
      coalesce((select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = s.cashier_id limit 1), 'Kasir dihapus') as cashier_name
    from public.shifts s join scope sc on sc.id = s.outlet_id
    where s.opened_at >= p_from and s.opened_at < p_to
  ),
  ledger as (
    select l.source_type, l.direction, sum(l.amount) as amount
    from public.cash_ledger l join sh on sh.id = l.shift_id
    where sh.status = 'closed'
    group by 1, 2
  ),
  ex as (
    select e.* from public.expenses e join sh on sh.id = e.shift_id
  ),
  ei as (
    select i.*, ex.shift_id from public.expense_items i join ex on ex.id = i.expense_id where ex.status = 'approved'
  ),
  tx as (
    select t.* from public.transactions t join scope s on s.id = t.outlet_id
    where t.created_at >= p_from and t.created_at < p_to
  ),
  vouchers as (
    select v.code, count(*)::int as cnt, sum(vr.amount) as amount
    from public.voucher_redemptions vr join tx on tx.id = vr.transaction_id and tx.status = 'completed'
    join public.vouchers v on v.id = vr.voucher_id
    group by v.code
  ),
  manual as (
    select count(*) filter (where d > 0)::int as cnt, coalesce(sum(d), 0) as amount
    from (
      select (tx.item_discount + tx.bill_discount) - coalesce((select sum(vr.amount) from public.voucher_redemptions vr where vr.transaction_id = tx.id), 0) as d
      from tx where tx.status = 'completed'
    ) x
  ),
  lines as (
    select lower(btrim(p.name)) as k, min(p.name) as name, coalesce(min(c.name), '') as category,
      sum(ti.quantity) as qty, sum(ti.net_subtotal) as sales, sum(ti.quantity * ti.hpp_unit) as hpp
    from public.transaction_items ti
    join tx on tx.id = ti.transaction_id and tx.status = 'completed'
    join public.products p on p.id = ti.product_id
    left join public.categories c on c.id = p.category_id
    group by 1
  )
  select jsonb_build_object(
    'pnl', public.report_pnl(b, p_outlet_id, p_from, p_to),
    'previousPnl', public.report_pnl(b, p_outlet_id, p_prev_from, p_prev_to),
    'outlets', coalesce((select jsonb_agg(s.name order by s.name) from scope s), '[]'::jsonb),
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'businessDate', x.business_date, 'shiftNumber', x.shift_number, 'outletName', x.outlet_name,
        'cashierName', x.cashier_name, 'open', x.status = 'open', 'openingCash', x.opening_cash, 'expectedCash', x.expected_cash,
        'closingCash', x.closing_cash, 'variance', x.variance) order by x.opened_at, x.id)
      from (select * from sh order by opened_at, id limit 500) x
    ), '[]'::jsonb),
    'cash', (
      select jsonb_build_object(
        'closed', count(*) filter (where status = 'closed'),
        'open', count(*) filter (where status = 'open'),
        'variance', coalesce(sum(variance), 0),
        'matched', count(*) filter (where status = 'closed' and variance = 0),
        'shortCount', count(*) filter (where variance < 0),
        'short', coalesce(sum(variance) filter (where variance < 0), 0),
        'overCount', count(*) filter (where variance > 0),
        'over', coalesce(sum(variance) filter (where variance > 0), 0))
      from sh),
    -- Laci shift yang sudah ditutup: kas awal + penjualan tunai - refund tunai - pengeluaran laci (+ lainnya) = kas seharusnya.
    'drawer', jsonb_build_object(
      'opening', coalesce((select sum(amount) from ledger where source_type = 'shift_opening' and direction = 'in'), 0),
      'cashSales', coalesce((select sum(amount) from ledger where source_type = 'payment' and direction = 'in'), 0),
      'refunds', coalesce((select sum(amount) from ledger where source_type = 'refund' and direction = 'out'), 0),
      'expenses', coalesce((select sum(amount) from ledger where source_type = 'expense' and direction = 'out'), 0),
      'other', coalesce((select sum(case when direction = 'in' then amount else -amount end) from ledger
        where source_type not in ('shift_opening', 'payment', 'refund', 'expense')), 0),
      'expected', coalesce((select sum(expected_cash) from sh where status = 'closed'), 0),
      'counted', coalesce((select sum(closing_cash) from sh where status = 'closed'), 0)),
    'expenses', jsonb_build_object(
      'total', (select coalesce(sum(amount), 0) from ei),
      'belanja', (select coalesce(sum(amount), 0) from ei where category = 'belanja'),
      'belanjaCount', (select count(*) from ei where category = 'belanja'),
      'operasional', (select coalesce(sum(amount), 0) from ei where category = 'operasional'),
      'operasionalCount', (select count(*) from ei where category = 'operasional'),
      'drawer', (select coalesce(sum(amount), 0) from ei where paid_from = 'drawer'),
      'other', (select coalesce(sum(amount), 0) from ei where paid_from = 'other'),
      'pendingCount', (select count(*) from ex where status = 'pending'),
      'pendingTotal', (select coalesce(sum(total), 0) from ex where status = 'pending'),
      'daily', coalesce((
        select jsonb_agg(jsonb_build_object('date', d.day, 'total', d.total) order by d.day)
        from (select sh.business_date as day, sum(ei.amount) as total from ei join sh on sh.id = ei.shift_id group by 1) d
      ), '[]'::jsonb),
      'top', coalesce((
        select jsonb_agg(jsonb_build_object('name', y.name, 'category', y.category, 'quantity', y.quantity, 'unit', y.unit,
          'amount', y.amount, 'businessDate', y.business_date, 'outletName', y.outlet_name) order by y.amount desc, y.name)
        from (select ei.*, sh.business_date, sh.outlet_name from ei join sh on sh.id = ei.shift_id order by ei.amount desc, ei.name limit 10) y
      ), '[]'::jsonb)),
    'voidsByCashier', coalesce((
      select jsonb_agg(jsonb_build_object('name', v.name, 'count', v.cnt, 'total', v.total) order by v.cnt desc, v.total desc, v.name)
      from (
        select coalesce((select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = tx.cashier_id limit 1), 'Kasir dihapus') as name,
          count(*)::int as cnt, sum(tx.total) as total
        from tx where tx.status = 'voided' group by tx.cashier_id
      ) v
    ), '[]'::jsonb),
    'discounts', coalesce((
      select jsonb_agg(z.o order by z.k)
      from (
        select 0 as k, jsonb_build_object('voucher', code, 'count', cnt, 'amount', amount) as o from vouchers
        union all
        select 1, jsonb_build_object('voucher', null, 'count', cnt, 'amount', amount) from manual where amount > 0
      ) z
    ), '[]'::jsonb),
    'cashierOutlets', coalesce((
      select jsonb_object_agg(cs.cashier_id, o.name) from public.cashier_sessions cs join scope o on o.id = cs.outlet_id
    ), '{}'::jsonb),
    'byCategory', coalesce((
      select jsonb_agg(jsonb_build_object('name', z.category, 'qty', z.qty, 'sales', z.sales, 'hpp', z.hpp) order by z.sales desc, z.category)
      from (select category, sum(qty) as qty, sum(sales) as sales, sum(hpp) as hpp from lines group by 1) z
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('name', p.name, 'category', p.category, 'qty', p.qty, 'sales', p.sales, 'hpp', p.hpp,
        'profit', p.sales - p.hpp) order by p.sales desc, p.name)
      from (select * from lines order by sales desc, name limit 100) p
    ), '[]'::jsonb),
    'productTotals', (select jsonb_build_object('qty', coalesce(sum(qty), 0), 'sales', coalesce(sum(sales), 0), 'hpp', coalesce(sum(hpp), 0)) from lines),
    'productCount', (select count(*) from lines)
  ) into result;
  return result;
end $$;
revoke all on function public.owner_report(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_report(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;
