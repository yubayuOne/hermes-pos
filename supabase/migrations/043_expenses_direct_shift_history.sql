-- 043: pengeluaran langsung dihitung tanpa persetujuan pemilik (permintaan pemilik, 15 Okt 2026), riwayat shift dan
-- daftar refund untuk POS.
-- * Status pending/approved/rejected dihapus. Setiap barang yang dicatat kasir langsung dihitung di laporan.
-- * Pemilik bisa mengubah barang satu shift kapan saja (owner_update_expense). Baris buku kas 'expense' shift itu
--   selalu sama dengan total barang dari laci. Kalau shift sudah ditutup, kas seharusnya dan selisihnya dihitung ulang
--   dari buku kas (hitungan uang kasir tetap).
-- * Kunci idempotensi kasir pindah ke expenses.entry_keys: kiriman ulang dari antrean offline tetap tidak tercatat dua
--   kali walau pemilik sudah mengganti barangnya.
-- * POS: list_outlet_shifts (riwayat laporan shift), list_shift_refunds (daftar refund di laporan shift),
--   list_bill_refunds (alasan refund di detail bill).

-- ---------------------------------------------------------------- skema
alter table public.expenses add column if not exists entry_keys text[] not null default '{}';
update public.expenses e set entry_keys = coalesce((
  select array_agg(distinct i.entry_key) from public.expense_items i where i.expense_id = e.id and i.entry_key is not null
), '{}');
alter table public.expense_items drop column if exists entry_key;

drop function if exists public.owner_review_expense(uuid, text, jsonb, text);
drop function if exists public.owner_list_expenses(text, uuid, timestamptz, timestamptz);
alter table public.expenses
  drop column if exists status,
  drop column if exists reviewed_at,
  drop column if exists reviewed_by,
  drop column if exists reject_reason;
create index if not exists expenses_business_created on public.expenses(business_id, created_at desc);

create or replace function public.expense_json(p_expense_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'createdAt', e.created_at, 'outletId', e.outlet_id, 'outletName', o.name, 'shiftId', e.shift_id,
    'businessDate', s.business_date, 'shiftNumber', s.shift_number, 'shiftOpen', s.status = 'open',
    'cashierName', (select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = e.cashier_id limit 1),
    'total', e.total,
    'drawerTotal', (select coalesce(sum(i.amount), 0) from public.expense_items i where i.expense_id = e.id and i.paid_from = 'drawer'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'category', i.category, 'quantity', i.quantity,
        'unit', i.unit, 'amount', i.amount, 'paidFrom', i.paid_from) order by i.position)
      from public.expense_items i where i.expense_id = e.id
    ), '[]'::jsonb))
  from public.expenses e join public.outlets o on o.id = e.outlet_id join public.shifts s on s.id = e.shift_id
  where e.id = p_expense_id
$$;
revoke all on function public.expense_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- kasir
create or replace function public.record_expense(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_paid_from text,
  p_items jsonb,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.expenses%rowtype;
  b uuid := public.business_of_outlet(p_outlet_id);
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_items jsonb;
  v_total numeric;
  v_count int := 0;
begin
  -- Mengunci shift: tutup shift, koreksi pemilik, dan kiriman lain di shift ini menunggu sampai selesai.
  perform public.assert_open_shift(p_shift_id, p_cashier_id, p_outlet_id);
  if v_key = '' then raise exception 'Kunci idempotensi wajib diisi'; end if;

  select * into e from public.expenses where shift_id = p_shift_id;
  -- Kirim ulang (tombol ditekan dua kali, antrean offline): kembalikan catatan yang sama.
  if e.id is not null and v_key = any(e.entry_keys) then
    return jsonb_build_object('ok', true, 'replayed', true) || public.expense_json(e.id);
  end if;

  if not public.subscription_active(b) then perform public.raise_expired('mencatat pengeluaran'); end if;
  if coalesce(p_paid_from, '') not in ('drawer', 'other') then raise exception 'Pilih sumber uang: kas laci atau bukan dari laci.'; end if;
  v_items := public.expense_items_checked(p_items, p_paid_from);
  if jsonb_array_length(v_items) > 30 then raise exception 'Maksimal 30 barang dalam satu catatan.'; end if;
  select sum((x->>'amount')::numeric) into v_total from jsonb_array_elements(v_items) x;

  if e.id is null then
    insert into public.expenses(business_id, outlet_id, shift_id, cashier_id, total, entry_keys)
    values (b, p_outlet_id, p_shift_id, p_cashier_id, v_total, array[v_key])
    returning * into e;
  else
    select count(*) into v_count from public.expense_items where expense_id = e.id;
    if v_count + jsonb_array_length(v_items) > 200 then raise exception 'Pengeluaran shift ini sudah mencapai 200 barang.'; end if;
    update public.expenses set total = total + v_total, entry_keys = entry_keys || v_key where id = e.id;
  end if;

  insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount, paid_from)
  select e.id, (v_count + x.ord - 1)::smallint, x.v->>'name', x.v->>'category', (x.v->>'quantity')::numeric, x.v->>'unit',
    (x.v->>'amount')::numeric, p_paid_from
  from jsonb_array_elements(v_items) with ordinality as x(v, ord);

  if p_paid_from = 'drawer' then
    insert into public.cash_ledger(shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id)
    values (p_shift_id, p_cashier_id, p_outlet_id, 'out', v_total, 'Pengeluaran', 'expense', e.id)
    on conflict (source_type, source_id) where source_id is not null do update set amount = public.cash_ledger.amount + excluded.amount;
  end if;

  insert into public.notifications(business_id, kind, params, dedupe_key)
  values (b, 'expense', jsonb_build_object('amount', v_total, 'count', jsonb_array_length(v_items), 'paid_from', p_paid_from,
    'cashier', (select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = p_cashier_id limit 1)), 'expense:' || e.id || ':' || v_key)
  on conflict (business_id, dedupe_key) do nothing;

  return jsonb_build_object('ok', true, 'replayed', false) || public.expense_json(e.id);
end $$;
revoke all on function public.record_expense(uuid, uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function public.record_expense(uuid, uuid, uuid, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------- pemilik
-- Satu baris per shift, urut tanggal bisnis terbaru (200 shift). Rentang memakai waktu catatan dibuat.
create or replace function public.owner_list_expenses(
  p_outlet_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
begin
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(public.expense_json(x.id) order by x.business_date desc, x.created_at desc, x.id)
      from (
        select e.id, e.created_at, s.business_date from public.expenses e join public.shifts s on s.id = e.shift_id
        where e.business_id = b and (p_outlet_id is null or e.outlet_id = p_outlet_id)
          and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
        order by s.business_date desc, e.created_at desc, e.id limit 200
      ) x
    ), '[]'::jsonb),
    -- Total per tanggal bisnis pada rentang yang sama: { "2026-10-15": 221000 }.
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
revoke all on function public.owner_list_expenses(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_list_expenses(uuid, timestamptz, timestamptz) to authenticated;

-- p_items: seluruh barang shift setelah diubah, tiap barang dengan "paidFrom". Shift buka atau sudah ditutup.
create or replace function public.owner_update_expense(p_expense_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  e public.expenses%rowtype;
  s public.shifts%rowtype;
  v_items jsonb;
  v_expected numeric;
begin
  select * into e from public.expenses where id = p_expense_id and business_id = b;
  if not found then raise exception 'Pengeluaran tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mengubah pengeluaran'); end if;
  v_items := public.expense_items_checked(p_items, null);

  -- Urutan kunci sama dengan record_expense dan close_shift: shift dulu, lalu catatannya.
  select * into s from public.shifts where id = e.shift_id for update;
  select * into e from public.expenses where id = e.id for update;

  delete from public.expense_items where expense_id = e.id;
  insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount, paid_from)
  select e.id, (x.ord - 1)::smallint, x.v->>'name', x.v->>'category', (x.v->>'quantity')::numeric, x.v->>'unit',
    (x.v->>'amount')::numeric, x.v->>'paidFrom'
  from jsonb_array_elements(v_items) with ordinality as x(v, ord);
  update public.expenses set total = (select sum((x->>'amount')::numeric) from jsonb_array_elements(v_items) x) where id = e.id;

  insert into public.cash_ledger(shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id)
  values (e.shift_id, e.cashier_id, e.outlet_id, 'out',
    (select coalesce(sum(i.amount), 0) from public.expense_items i where i.expense_id = e.id and i.paid_from = 'drawer'),
    'Pengeluaran', 'expense', e.id)
  on conflict (source_type, source_id) where source_id is not null do update set amount = excluded.amount;

  if s.status = 'closed' then
    select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) into v_expected
    from public.cash_ledger where shift_id = s.id;
    update public.shifts set expected_cash = v_expected, variance = closing_cash - v_expected where id = s.id;
  end if;

  return public.expense_json(e.id);
end $$;
revoke all on function public.owner_update_expense(uuid, jsonb) from public, anon;
grant execute on function public.owner_update_expense(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- laporan pemilik: semua pengeluaran dihitung
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
    where sh.opened_at >= p_from and sh.opened_at < p_to
  )
  select jsonb_build_object(
    'grossSales', tx.sales + tx.discounts, 'discounts', tx.discounts, 'refunds', rf.total, 'netSales', tx.sales - rf.total,
    'count', tx.cnt, 'hpp', tx.hpp - rf.restock_hpp, 'grossProfit', (tx.sales - rf.total) - (tx.hpp - rf.restock_hpp),
    'operatingExpenses', ex.opex, 'inventoryPurchases', ex.inventory,
    'operatingProfit', (tx.sales - rf.total) - (tx.hpp - rf.restock_hpp) - ex.opex)
  from tx, rf, ex
$$;
revoke all on function public.report_pnl(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Sama dengan 042, tanpa filter status dan tanpa pendingCount/pendingTotal.
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

-- ---------------------------------------------------------------- POS: riwayat shift dan refund
-- Semua shift outlet (buka dan ditutup), terbaru dulu, per halaman. p_before: openedAt baris terakhir halaman sebelumnya.
-- sales = penjualan bersih refund, sama dengan totalRevenue get_shift_report.
create or replace function public.list_outlet_shifts(p_cashier_id uuid, p_outlet_id uuid, p_before timestamptz default null, p_limit int default 30)
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
      where outlet_id = p_outlet_id and (p_before is null or opened_at < p_before)
      order by opened_at desc, id limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) s
  ), '[]'::jsonb);
end $$;
revoke all on function public.list_outlet_shifts(uuid, uuid, timestamptz, int) from public, anon;
grant execute on function public.list_outlet_shifts(uuid, uuid, timestamptz, int) to authenticated;

create or replace function public.refund_json(p_refund_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'createdAt', r.created_at, 'number', t.number, 'method', r.method::text, 'amount', r.amount, 'reason', r.reason,
    'cashierName', coalesce((select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = r.cashier_id limit 1), 'Kasir dihapus'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('productName', pr.name, 'quantity', ri.quantity, 'amount', ri.amount, 'restock', ri.restock) order by pr.name)
      from public.transaction_refund_items ri
      join public.transaction_items ti on ti.id = ri.transaction_item_id
      join public.products pr on pr.id = ti.product_id
      where ri.refund_id = r.id
    ), '[]'::jsonb))
  from public.transaction_refunds r join public.transactions t on t.id = r.transaction_id
  where r.id = p_refund_id
$$;
revoke all on function public.refund_json(uuid) from public, anon, authenticated;

-- Refund yang terjadi di shift ini (bisa untuk bill shift lain), urut waktu.
create or replace function public.list_shift_refunds(p_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.shifts%rowtype;
begin
  select * into s from public.shifts where id = p_shift_id;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(s.cashier_id, s.outlet_id);
  return coalesce((
    select jsonb_agg(public.refund_json(r.id) order by r.created_at, r.id) from public.transaction_refunds r where r.shift_id = p_shift_id
  ), '[]'::jsonb);
end $$;
revoke all on function public.list_shift_refunds(uuid) from public, anon;
grant execute on function public.list_shift_refunds(uuid) to authenticated;

create or replace function public.list_bill_refunds(p_transaction_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.transactions%rowtype;
begin
  select * into t from public.transactions where id = p_transaction_id;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id, t.outlet_id);
  return coalesce((
    select jsonb_agg(public.refund_json(r.id) order by r.created_at, r.id) from public.transaction_refunds r where r.transaction_id = p_transaction_id
  ), '[]'::jsonb);
end $$;
revoke all on function public.list_bill_refunds(uuid) from public, anon;
grant execute on function public.list_bill_refunds(uuid) to authenticated;
