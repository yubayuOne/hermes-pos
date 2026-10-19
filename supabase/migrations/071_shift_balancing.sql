-- Balancing per shift replaces the owner's edits of bills and expenses (owner's decision, 19 Oct 2026).
-- What the cashier recorded is never changed; the owner adds a signed adjustment line with a reason:
--   * cash:    money in (+) or out (-) of the drawer. Writes a cash_ledger row, so the shift's expected cash and, once
--              closed, its variance follow.
--   * sales:   correction of the shift's sales (+/-). Counts in net sales, profit, and the sales charts; not in cash.
--   * expense: correction of the shift's expenses (+/-), operasional or belanja. Counts in the expense totals and P&L.
-- An adjustment counts on its shift's opening time (effective_at), like expenses in report_pnl. There is no edit or
-- delete: a mistake is fixed with an opposite line, so the trail stays complete.
-- Removed: owner item, payment, and detail edits of bills (066/067) and owner_update_expense (043). Void stays.

create table if not exists public.shift_adjustments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id),
  kind text not null check (kind in ('cash', 'sales', 'expense')),
  category text check (category in ('operasional', 'belanja')),
  amount numeric(14,2) not null check (amount <> 0 and amount = round(amount) and abs(amount) <= 1000000000),
  reason text not null check (char_length(reason) between 3 and 200),
  effective_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((kind = 'expense') = (category is not null))
);
create index if not exists shift_adjustments_shift on public.shift_adjustments(shift_id);
create index if not exists shift_adjustments_outlet_at on public.shift_adjustments(outlet_id, effective_at);
alter table public.shift_adjustments enable row level security;
revoke all on public.shift_adjustments from public, anon, authenticated;

drop function if exists public.owner_set_bill_payment(uuid, public.payment_method, text);
drop function if exists public.owner_update_bill_details(uuid, text, text, jsonb);
drop function if exists public.owner_update_bill_items(uuid, jsonb, text);
drop function if exists public._066_set_bill_payment(uuid, public.payment_method);
drop function if exists public._066_update_bill_details(uuid, text, text, jsonb);
drop function if exists public._066_update_bill_items(uuid, jsonb);
drop function if exists public.owner_update_expense(uuid, jsonb);

-- ---------------------------------------------------------------- write
create or replace function public.owner_add_shift_adjustment(p_shift_id uuid, p_kind text, p_amount numeric, p_category text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  s public.shifts%rowtype;
  a public.shift_adjustments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_kind is null or p_kind not in ('cash', 'sales', 'expense') then raise exception 'Jenis penyesuaian tidak valid'; end if;
  if p_amount is null or p_amount = 0 or p_amount <> round(p_amount) or abs(p_amount) > 1000000000 then
    raise exception 'Nominal harus angka bulat, tidak nol, maksimal Rp1.000.000.000';
  end if;
  if (p_kind = 'expense') <> (p_category is not null) or (p_category is not null and p_category not in ('operasional', 'belanja')) then
    raise exception 'Pilih kategori pengeluaran';
  end if;
  if char_length(v_reason) < 3 then raise exception 'Alasan wajib diisi, minimal 3 karakter'; end if;
  if char_length(v_reason) > 200 then raise exception 'Alasan maksimal 200 karakter'; end if;

  select * into s from public.shifts where id = p_shift_id;
  if not found or not public.is_owner_of_outlet(s.outlet_id) then raise exception 'Shift tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('menambah penyesuaian'); end if;
  -- Same lock order as close_shift: the shift first.
  select * into s from public.shifts where id = p_shift_id for update;

  insert into public.shift_adjustments(shift_id, outlet_id, kind, category, amount, reason, effective_at, created_by)
  values (s.id, s.outlet_id, p_kind, p_category, p_amount, v_reason, s.opened_at, auth.uid())
  returning * into a;

  if p_kind = 'cash' then
    insert into public.cash_ledger(shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id)
    values (s.id, s.cashier_id, s.outlet_id, (case when p_amount > 0 then 'in' else 'out' end)::public.cash_ledger_direction, abs(p_amount),
      'Penyesuaian: ' || v_reason, 'adjustment', a.id);
    perform public._066_recount_shift(s.id);
  end if;
  return jsonb_build_object('id', a.id, 'kind', a.kind, 'category', a.category, 'amount', a.amount, 'reason', a.reason, 'createdAt', a.created_at);
end $$;

-- ---------------------------------------------------------------- read: the Balancing page
-- Shifts opened in the range, newest first, 50 a page, with their money and adjustments.
create or replace function public.owner_list_shift_balances(p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_page integer default 1)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); off integer;
begin
  if p_outlet_id is not null and not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_to <= p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal terlalu panjang'; end if;
  off := (greatest(coalesce(p_page, 1), 1) - 1) * 50;

  return (
    with sh as (
      select s.* from public.shifts s join public.outlets o on o.id = s.outlet_id
      where o.business_id = b and (p_outlet_id is null or o.id = p_outlet_id) and s.opened_at >= p_from and s.opened_at < p_to
    )
    select jsonb_build_object(
      'total', (select count(*) from sh),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', x.id, 'outletName', o.name, 'businessDate', x.business_date, 'shiftNumber', x.shift_number,
          'cashierName', coalesce((select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = x.cashier_id limit 1), 'Kasir dihapus'),
          'open', x.status = 'open', 'openedAt', x.opened_at, 'closedAt', x.closed_at, 'openingCash', x.opening_cash,
          -- An open shift has no stored expected cash yet: the cash book so far.
          'expectedCash', case when x.status = 'closed' then x.expected_cash
            else (select coalesce(sum(case when l.direction = 'in' then l.amount else -l.amount end), 0) from public.cash_ledger l where l.shift_id = x.id) end,
          'closingCash', x.closing_cash, 'variance', x.variance,
          'sales', coalesce((select sum(t.total) from public.transactions t where t.shift_id = x.id and t.status = 'completed'), 0)
            - coalesce((select sum(r.amount) from public.transaction_refunds r where r.shift_id = x.id), 0)
            + coalesce((select sum(a.amount) from public.shift_adjustments a where a.shift_id = x.id and a.kind = 'sales'), 0),
          'expenses', coalesce((select e.total from public.expenses e where e.shift_id = x.id), 0)
            + coalesce((select sum(a.amount) from public.shift_adjustments a where a.shift_id = x.id and a.kind = 'expense'), 0),
          'adjustments', coalesce((
            select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'category', a.category, 'amount', a.amount,
              'reason', a.reason, 'createdAt', a.created_at) order by a.created_at, a.id)
            from public.shift_adjustments a where a.shift_id = x.id), '[]'::jsonb)
        ) order by x.opened_at desc, x.id)
        from (select * from sh order by opened_at desc, id limit 50 offset off) x
        join public.outlets o on o.id = x.outlet_id
      ), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.owner_add_shift_adjustment(uuid, text, numeric, text, text) from public, anon;
revoke all on function public.owner_list_shift_balances(uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.owner_add_shift_adjustment(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.owner_list_shift_balances(uuid, timestamptz, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------- reports count the adjustments
-- Same as 062 plus expense adjustments (not from the drawer, so under 'other').
create or replace function public.owner_expense_totals(p_business uuid, p_outlet_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer set search_path = public as $$
  with it as (
    select i.amount, i.category, i.paid_from
    from public.expenses e join public.expense_items i on i.expense_id = e.id
    where e.business_id = p_business and (p_outlet_id is null or e.outlet_id = p_outlet_id)
      and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
    union all
    select a.amount, a.category, 'other'
    from public.shift_adjustments a join public.outlets o on o.id = a.outlet_id
    where a.kind = 'expense' and o.business_id = p_business and (p_outlet_id is null or a.outlet_id = p_outlet_id)
      and (p_from is null or a.effective_at >= p_from) and (p_to is null or a.effective_at < p_to)
  )
  select jsonb_build_object(
    'total', coalesce(sum(amount), 0),
    'operasional', coalesce(sum(amount) filter (where category = 'operasional'), 0),
    'belanja', coalesce(sum(amount) filter (where category = 'belanja'), 0),
    'drawer', coalesce(sum(amount) filter (where paid_from = 'drawer'), 0),
    'other', coalesce(sum(amount) filter (where paid_from = 'other'), 0))
  from it
$$;

-- Same as 043 plus 'adjustments' (sales) and the adjustments in net sales, profit, and expenses.
create or replace function public.report_pnl(p_business uuid, p_outlet_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer set search_path = public as $$
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
  ), adj as (
    select coalesce(sum(a.amount) filter (where a.kind = 'sales'), 0) as sales,
      coalesce(sum(a.amount) filter (where a.kind = 'expense' and a.category = 'operasional'), 0) as opex,
      coalesce(sum(a.amount) filter (where a.kind = 'expense' and a.category = 'belanja'), 0) as inventory
    from public.shift_adjustments a join scope s on s.id = a.outlet_id
    where a.effective_at >= p_from and a.effective_at < p_to
  )
  select jsonb_build_object(
    'grossSales', tx.sales + tx.discounts, 'discounts', tx.discounts, 'refunds', rf.total, 'adjustments', adj.sales,
    'netSales', tx.sales - rf.total + adj.sales,
    'count', tx.cnt, 'hpp', tx.hpp - rf.restock_hpp, 'grossProfit', (tx.sales - rf.total + adj.sales) - (tx.hpp - rf.restock_hpp),
    'operatingExpenses', ex.opex + adj.opex, 'inventoryPurchases', ex.inventory + adj.inventory,
    'operatingProfit', (tx.sales - rf.total + adj.sales) - (tx.hpp - rf.restock_hpp) - (ex.opex + adj.opex))
  from tx, rf, ex, adj
$$;

-- Same as 064 plus sales adjustments in sales, profit, the previous period, and the per-day/outlet/cashier moves.
create or replace function public.owner_sales_summary(p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); result jsonb; v_tz text := public.business_tz(b);
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
  adj as (
    select a.outlet_id, sh.cashier_id, a.effective_at as created_at, a.amount
    from public.shift_adjustments a join scope s on s.id = a.outlet_id join public.shifts sh on sh.id = a.shift_id
    where a.kind = 'sales' and a.effective_at >= p_from and a.effective_at < p_to
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
  atot as (select coalesce(sum(amount), 0) as total from adj),
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
           ), 0) + coalesce((
             select sum(a.amount) from public.shift_adjustments a join scope s3 on s3.id = a.outlet_id
             where a.kind = 'sales' and a.effective_at >= p_prev_from and a.effective_at < p_prev_to
           ), 0) as sales
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'completed' and t.created_at >= p_prev_from and t.created_at < p_prev_to
  ),
  voided as (
    select count(*)::int as cnt, coalesce(sum(t.total), 0) as total
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'voided' and t.created_at >= p_from and t.created_at < p_to
  ),
  -- Sales positive, refunds negative, adjustments signed: one source for per day, per outlet, and per cashier.
  moves as (
    select outlet_id, cashier_id, created_at, total as amount, 1 as bill from tx
    union all
    select outlet_id, cashier_id, created_at, -amount, 0 from rf
    union all
    select outlet_id, cashier_id, created_at, amount, 0 from adj
  )
  select jsonb_build_object(
    'count', t.cnt,
    'sales', t.sales - r.total + a.total,
    'profit', (t.sales - r.total + a.total) - (t.hpp - r.restock_hpp),
    'cash', t.cash - r.cash,
    'qris', t.qris - r.qris,
    'refundCount', r.cnt,
    'refundTotal', r.total,
    'adjustmentTotal', a.total,
    'discountTotal', t.discount,
    'totalItems', coalesce((select sum(qty) from items), 0),
    'menuCount', (select count(*) from items),
    'previousSales', (select sales from prev),
    'previousCount', (select cnt from prev),
    'voidedCount', (select cnt from voided),
    'voidedTotal', (select total from voided),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'count', d.cnt, 'total', d.total) order by d.day)
      from (select (created_at at time zone v_tz)::date as day, sum(bill)::int as cnt, sum(amount) as total from moves group by 1) d
    ), '[]'::jsonb),
    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'total', h.total) order by h.hour)
      from (select extract(hour from created_at at time zone v_tz)::int as hour, sum(total) as total from tx group by 1) h
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
  from totals t, rtot r, atot a;
  return result;
end $$;

-- Same as 064 plus sales adjustments in the 7-day chart.
create or replace function public.owner_dashboard(p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz,
  p_week_from timestamptz, p_today_from timestamptz, p_today_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_tz text := public.business_tz(b);
  v_period jsonb;
  v_exp jsonb;
  v_week jsonb;
  v_today jsonb;
  v_last jsonb;
begin
  -- Checks the outlet and the period range.
  v_period := public.owner_sales_summary(p_outlet_id, p_from, p_to, p_prev_from, p_prev_to);
  if p_today_from < p_week_from or p_today_to <= p_today_from or p_today_to - p_week_from > interval '8 days' then
    raise exception 'Rentang tanggal tidak valid';
  end if;
  v_exp := public.owner_expense_totals(b, p_outlet_id, p_from, p_to);

  with scope as (
    select o.id from public.outlets o where o.business_id = b and (p_outlet_id is null or o.id = p_outlet_id)
  ),
  tx as (
    select t.created_at, t.total from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'completed' and t.created_at >= p_week_from and t.created_at < p_today_to
  ),
  moves as (
    select created_at, total as amount, 1 as bill from tx
    union all
    select r.created_at, -r.amount, 0 from public.transaction_refunds r join scope s on s.id = r.outlet_id
    where r.created_at >= p_week_from and r.created_at < p_today_to
    union all
    select a.effective_at, a.amount, 0 from public.shift_adjustments a join scope s on s.id = a.outlet_id
    where a.kind = 'sales' and a.effective_at >= p_week_from and a.effective_at < p_today_to
  )
  select
    jsonb_build_object(
      'count', coalesce((select sum(bill) from moves), 0)::int,
      'sales', coalesce((select sum(amount) from moves), 0),
      'daily', coalesce((
        select jsonb_agg(jsonb_build_object('date', d.day, 'count', d.cnt, 'total', d.total) order by d.day)
        from (select (created_at at time zone v_tz)::date as day, sum(bill)::int as cnt, sum(amount) as total from moves group by 1) d
      ), '[]'::jsonb)),
    jsonb_build_object('hourly', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'total', h.total) order by h.hour)
      from (
        select extract(hour from created_at at time zone v_tz)::int as hour, sum(total) as total
        from tx where created_at >= p_today_from group by 1
      ) h
    ), '[]'::jsonb))
  into v_week, v_today;

  select jsonb_build_object('amount', s.variance, 'closedAt', s.closed_at) into v_last
  from public.shifts s
  where s.outlet_id in (select o.id from public.outlets o where o.business_id = b and (p_outlet_id is null or o.id = p_outlet_id))
    and s.status = 'closed' and s.variance is not null
  order by s.closed_at desc
  limit 1;

  return jsonb_build_object(
    'period', v_period || jsonb_build_object(
      'expenses', v_exp,
      'salesAfterExpenses', coalesce((v_period ->> 'sales')::numeric, 0) - (v_exp ->> 'total')::numeric),
    'week', v_week,
    'today', v_today,
    'lastVariance', v_last
  );
end $$;

-- Same as 064 plus sales adjustments in the report's sales figures and expense adjustments in its expense totals.
create or replace function public.owner_report_page(p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_tz text := public.business_tz(b);
  -- Checks the outlet and the range.
  v_report jsonb := public.owner_report(p_outlet_id, p_from, p_to, p_prev_from, p_prev_to);
  v_sales jsonb;
  v_exp record;
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
  adj as (
    select a.outlet_id, sh.cashier_id, a.effective_at as created_at, a.amount
    from public.shift_adjustments a join scope s on s.id = a.outlet_id join public.shifts sh on sh.id = a.shift_id
    where a.kind = 'sales' and a.effective_at >= p_from and a.effective_at < p_to
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
  atot as (select coalesce(sum(amount), 0) as total from adj),
  voided as (
    select count(*)::int as cnt, coalesce(sum(t.total), 0) as total
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'voided' and t.created_at >= p_from and t.created_at < p_to
  ),
  moves as (
    select outlet_id, cashier_id, created_at, total as amount, 1 as bill from tx
    union all
    select outlet_id, cashier_id, created_at, -amount, 0 from rf
    union all
    select outlet_id, cashier_id, created_at, amount, 0 from adj
  )
  select jsonb_build_object(
    'count', t.cnt,
    'sales', t.sales - r.total + a.total,
    'cash', t.cash - r.cash,
    'qris', t.qris - r.qris,
    'refundCount', r.cnt,
    'refundTotal', r.total,
    'adjustmentTotal', a.total,
    'voidedCount', (select cnt from voided),
    'voidedTotal', (select total from voided),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'count', d.cnt, 'total', d.total) order by d.day)
      from (select (created_at at time zone v_tz)::date as day, sum(bill)::int as cnt, sum(amount) as total from moves group by 1) d
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
  from totals t, rtot r, atot a;

  -- Expense adjustments of shifts opened in the range, added to the report's expense totals (as report_pnl counts them).
  select coalesce(sum(a.amount), 0) as total,
         coalesce(sum(a.amount) filter (where a.category = 'operasional'), 0) as opex,
         coalesce(sum(a.amount) filter (where a.category = 'belanja'), 0) as belanja
  into v_exp
  from public.shift_adjustments a join public.outlets o on o.id = a.outlet_id
  where a.kind = 'expense' and o.business_id = b and (p_outlet_id is null or o.id = p_outlet_id)
    and a.effective_at >= p_from and a.effective_at < p_to;

  return v_report
    || jsonb_build_object('sales', v_sales)
    || jsonb_build_object('expenses', (v_report -> 'expenses') || jsonb_build_object(
      'total', (v_report -> 'expenses' ->> 'total')::numeric + v_exp.total,
      'operasional', (v_report -> 'expenses' ->> 'operasional')::numeric + v_exp.opex,
      'belanja', (v_report -> 'expenses' ->> 'belanja')::numeric + v_exp.belanja,
      'other', (v_report -> 'expenses' ->> 'other')::numeric + v_exp.total,
      'adjustments', v_exp.total));
end $$;

-- Same as 045 plus expense adjustments in the totals ('adjustments' says how much of them they are).
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
  v_totals jsonb := public.owner_expense_totals(b, p_outlet_id, p_from, p_to);
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
    'dayTotals', coalesce((
      select jsonb_object_agg(x.d, x.t) from (
        select s.business_date::text as d, sum(e.total) as t from public.expenses e join public.shifts s on s.id = e.shift_id
        where e.business_id = b and (p_outlet_id is null or e.outlet_id = p_outlet_id)
          and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
        group by s.business_date
      ) x
    ), '{}'::jsonb),
    'totals', jsonb_build_object(
      'total', v_totals -> 'total', 'operasional', v_totals -> 'operasional', 'belanja', v_totals -> 'belanja',
      'adjustments', coalesce((
        select sum(a.amount) from public.shift_adjustments a join public.outlets o on o.id = a.outlet_id
        where a.kind = 'expense' and o.business_id = b and (p_outlet_id is null or a.outlet_id = p_outlet_id)
          and (p_from is null or a.effective_at >= p_from) and (p_to is null or a.effective_at < p_to)), 0))
  );
end $$;
