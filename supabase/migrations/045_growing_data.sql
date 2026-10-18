-- 045: data yang terus bertambah (diukur dengan supabase/tests/perf_volume.sql: 1 tahun, 220.000 bill, 2.190 shift).
-- * owner_list_expenses: per halaman (50, kursor createdAt) + jumlah total, supaya backoffice tidak memuat 200 catatan
--   sekaligus (150 KB). Total per hari dan per kategori tetap untuk seluruh rentang.
-- * owner_report, owner_sales_summary: CTE tx tidak lagi di-materialize. Dipakai di beberapa tempat, jadi Postgres
--   menyalin semua bill rentang itu lalu join tanpa indeks.
-- * list_outlet_shifts: p_from opsional untuk filter periode di POS.
-- * Notifikasi yang sudah dibaca dan berumur lebih dari 90 hari dihapus tiap hari (pg_cron bila aktif).
-- * owner_report dan owner_sales_summary menjumlahkan item per produk dulu, baru join ke produk; manual discount
--   memakai join, bukan subquery per bill. Hasil ukur 365 hari: report 4,0 s -> 1,1 s, summary 1,7 s -> 1,2 s;
--   30 hari: di bawah 200 ms. Tabel ringkasan harian belum perlu; ukur ulang kalau bisnis jauh lebih besar.

-- ---------------------------------------------------------------- pengeluaran per halaman
drop function if exists public.owner_list_expenses(uuid, timestamptz, timestamptz);
create or replace function public.owner_list_expenses(
  p_outlet_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_before timestamptz default null,
  p_limit int default 50
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
begin
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(public.expense_json(x.id) order by x.created_at desc, x.id)
      from (
        select e.id, e.created_at from public.expenses e
        where e.business_id = b and (p_outlet_id is null or e.outlet_id = p_outlet_id)
          and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
          and (p_before is null or e.created_at < p_before)
        order by e.created_at desc, e.id limit least(greatest(coalesce(p_limit, 50), 1), 100)
      ) x
    ), '[]'::jsonb),
    'total', (select count(*) from public.expenses e
      where e.business_id = b and (p_outlet_id is null or e.outlet_id = p_outlet_id)
        and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)),
    -- Total per tanggal bisnis pada seluruh rentang: { "2026-10-15": 221000 }.
    'dayTotals', coalesce((
      select jsonb_object_agg(x.d, x.t) from (
        select s.business_date::text as d, sum(e.total) as t from public.expenses e join public.shifts s on s.id = e.shift_id
        where e.business_id = b and (p_outlet_id is null or e.outlet_id = p_outlet_id)
          and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
        group by s.business_date
      ) x
    ), '{}'::jsonb),
    'totals', (
      select jsonb_build_object(
        'total', coalesce(sum(i.amount), 0),
        'operasional', coalesce(sum(i.amount) filter (where i.category = 'operasional'), 0),
        'belanja', coalesce(sum(i.amount) filter (where i.category = 'belanja'), 0))
      from public.expenses e join public.expense_items i on i.expense_id = e.id
      where e.business_id = b and (p_outlet_id is null or e.outlet_id = p_outlet_id)
        and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to))
  );
end $$;
revoke all on function public.owner_list_expenses(uuid, timestamptz, timestamptz, timestamptz, int) from public, anon;
grant execute on function public.owner_list_expenses(uuid, timestamptz, timestamptz, timestamptz, int) to authenticated;

-- ---------------------------------------------------------------- riwayat shift POS + filter periode
drop function if exists public.list_outlet_shifts(uuid, uuid, timestamptz, int);
create or replace function public.list_outlet_shifts(
  p_cashier_id uuid, p_outlet_id uuid, p_before timestamptz default null, p_limit int default 30, p_from timestamptz default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'cashierId', s.cashier_id,
      'cashierName', coalesce((select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = s.cashier_id limit 1), 'Kasir dihapus'),
      'businessDate', s.business_date, 'shiftNumber', s.shift_number, 'status', s.status, 'openedAt', s.opened_at, 'closedAt', s.closed_at,
      'openingCash', s.opening_cash, 'closingCash', s.closing_cash, 'expectedCash', s.expected_cash, 'variance', s.variance,
      'sales', coalesce((select sum(t.total) from public.transactions t where t.shift_id = s.id and t.status = 'completed'), 0)
        - coalesce((select sum(r.amount) from public.transaction_refunds r where r.shift_id = s.id), 0),
      'expenses', coalesce((select e.total from public.expenses e where e.shift_id = s.id), 0)
    ) order by s.opened_at desc, s.id)
    from (
      select * from public.shifts
      where outlet_id = p_outlet_id and (p_before is null or opened_at < p_before) and (p_from is null or opened_at >= p_from)
      order by opened_at desc, id limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) s
  ), '[]'::jsonb);
end $$;
revoke all on function public.list_outlet_shifts(uuid, uuid, timestamptz, int, timestamptz) from public, anon;
grant execute on function public.list_outlet_shifts(uuid, uuid, timestamptz, int, timestamptz) to authenticated;

-- ---------------------------------------------------------------- notifikasi lama
-- Yang belum dibaca tidak pernah dihapus. Fungsi internal: dipanggil pg_cron, tidak oleh klien.
create or replace function public.cleanup_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.notifications where read_at is not null and created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.cleanup_notifications() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'hermes-pos-cleanup-notifications') then
      perform cron.unschedule('hermes-pos-cleanup-notifications');
    end if;
    -- 20:30 UTC = 03:30 WIB, setelah pembersihan produk sementara.
    perform cron.schedule('hermes-pos-cleanup-notifications', '30 20 * * *', 'select public.cleanup_notifications()');
  end if;
end $$;

-- ---------------------------------------------------------------- laporan pemilik
-- Sama dengan 043, tx tanpa materialize dan agregasi item per produk dulu.
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
  ei as (
    select i.*, e.shift_id from public.expense_items i join public.expenses e on e.id = i.expense_id join sh on sh.id = e.shift_id
  ),
  tx as not materialized (
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
      -- One redemption per bill at most (unique transaction_id), so a join replaces the per-bill subquery.
      select (tx.item_discount + tx.bill_discount) - coalesce(vr.amount, 0) as d
      from tx left join public.voucher_redemptions vr on vr.transaction_id = tx.id where tx.status = 'completed'
    ) x
  ),
  -- Sum per product first, then join the few product rows (joining 400.000 items to products took 3,9 s).
  lines as (
    select lower(btrim(p.name)) as k, min(p.name) as name, coalesce(min(c.name), '') as category,
      sum(x.qty) as qty, sum(x.sales) as sales, sum(x.hpp) as hpp
    from (
      select ti.product_id, sum(ti.quantity) as qty, sum(ti.net_subtotal) as sales, sum(ti.quantity * ti.hpp_unit) as hpp
      from public.transaction_items ti join tx on tx.id = ti.transaction_id and tx.status = 'completed'
      group by 1
    ) x
    join public.products p on p.id = x.product_id
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

-- Sama dengan 034, tx tanpa materialize.
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
  tx as not materialized (
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
  -- Sum per product first, then join the few product rows (same reason as lines in owner_report).
  items as (
    select min(pr.name) as name, pr.station, sum(x.qty) as qty, sum(x.subtotal) as subtotal
    from (
      select ti.product_id, sum(ti.quantity) as qty, sum(ti.net_subtotal) as subtotal
      from public.transaction_items ti join tx on tx.id = ti.transaction_id
      group by 1
    ) x
    join public.products pr on pr.id = x.product_id
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
