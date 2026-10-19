-- Bookkeeping, stage 1 (docs/ACCOUNTING.md): the ledger, the bill discount on every line, and the automatic checks.
--
-- 1) transaction_items.bill_discount_share: a bill's discount is split over its lines when the bill is paid (largest
--    remainder on the last line, so the shares add up to the rupiah). Every per-product figure is now net of all
--    discounts, so the products add up to the sales (P4). Paid bills are backfilled.
-- 2) transactions.void_posted_at: when set, a void is booked on that date instead of erasing the sale from its own day.
--    Stays null until days can be locked (stage 4); the ledger already reads it.
-- 3) ledger: every recorded event as balanced lines (debit +, credit -), read from the documents themselves. Documents
--    are never changed, so the ledger never drifts. Internal: reports and checks read it through definer functions.
-- 4) ledger_checks(business, from, to): the balance rules P1-P5 (docs/ACCOUNTING.md section 1); an empty list means all is
--    in balance.

alter table public.transaction_items add column if not exists bill_discount_share numeric(14,2) not null default 0;
alter table public.transactions add column if not exists void_posted_at timestamptz;

-- Splits the bill discount over the lines by their net amount; the last line (by id) takes what rounding leaves.
create or replace function public.allocate_bill_discount(p_transaction_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_bd numeric; v_base numeric;
begin
  select bill_discount into v_bd from public.transactions where id = p_transaction_id;
  select coalesce(sum(net_subtotal), 0) into v_base from public.transaction_items where transaction_id = p_transaction_id;
  if coalesce(v_bd, 0) = 0 or v_base <= 0 then
    update public.transaction_items set bill_discount_share = 0 where transaction_id = p_transaction_id and bill_discount_share <> 0;
    return;
  end if;
  with lines as (
    select id, net_subtotal, row_number() over (order by id desc) as rn,
      round(v_bd * net_subtotal / v_base) as share
    from public.transaction_items where transaction_id = p_transaction_id
  )
  update public.transaction_items ti
  set bill_discount_share = case when l.rn = 1 then v_bd - coalesce((select sum(share) from lines where rn > 1), 0) else l.share end
  from lines l where l.id = ti.id;
end $$;
revoke all on function public.allocate_bill_discount(uuid) from public, anon, authenticated;

create or replace function public.trg_allocate_bill_discount()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.allocate_bill_discount(new.id);
  return new;
end $$;
revoke all on function public.trg_allocate_bill_discount() from public, anon, authenticated;
drop trigger if exists transaction_allocate_bill_discount on public.transactions;
create trigger transaction_allocate_bill_discount
  after update of status on public.transactions
  for each row when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.trg_allocate_bill_discount();

-- Backfill: every paid or voided bill with a bill discount.
do $$ begin perform public.allocate_bill_discount(id) from public.transactions where status in ('completed', 'voided') and bill_discount <> 0; end $$;

-- ---------------------------------------------------------------- the ledger
-- Accounts: cash_drawer (per shift), cash_outside (money outside the drawer: owner, safe, bank), qris, receivable_other
-- (other payment methods), sales (gross, per product), discount (item discount + bill share, per product), sales_return
-- (refunds, per product), cogs, inventory (tracked products), cost_absorbed (cost of untracked products, set against the
-- ingredient purchases), expense (operasional), purchase (belanja), cash_variance, correction_sales, correction_expense,
-- correction_offset (balancing lines from 071).
create or replace view public.ledger as
with sale_tx as (
  select t.*, o.business_id from public.transactions t join public.outlets o on o.id = t.outlet_id
  where t.status = 'completed' or (t.status = 'voided' and t.void_posted_at is not null)
),
sale_lines as (
  select t.business_id, t.outlet_id, t.shift_id, t.cashier_id, t.created_at as at, t.id as doc_id, t.void_posted_at,
    case t.payment_method when 'cash' then 'cash_drawer' when 'qris' then 'qris' else 'receivable_other' end as account,
    null::text as category, null::uuid as product_id, null::numeric as qty, t.total as amount
  from sale_tx t
  union all
  select t.business_id, t.outlet_id, t.shift_id, t.cashier_id, t.created_at, t.id, t.void_posted_at,
    x.account, null, ti.product_id, x.qty, x.amount
  from sale_tx t
  join public.transaction_items ti on ti.transaction_id = t.id
  left join public.products p on p.id = ti.product_id
  cross join lateral (values
    ('sales', -ti.quantity, -(ti.quantity * ti.selling_price_unit)),
    ('discount', null::numeric, ti.discount_amount + ti.bill_discount_share),
    ('cogs', null::numeric, ti.quantity * ti.hpp_unit),
    (case when coalesce(p.track_stock, false) then 'inventory' else 'cost_absorbed' end, -ti.quantity, -(ti.quantity * ti.hpp_unit))
  ) as x(account, qty, amount)
  where x.amount <> 0
)
select business_id, outlet_id, shift_id, cashier_id, at, 'sale'::text as doc_type, doc_id, account, category, product_id, qty, amount
from sale_lines
union all
-- A void booked on its own date (a locked day): the sale reversed line by line.
select business_id, outlet_id, shift_id, cashier_id, void_posted_at, 'void', doc_id, account, category, product_id, -qty, -amount
from sale_lines where void_posted_at is not null
union all
-- Refunds: money out by the refund's method, the return per product, and the restocked cost back in stock.
select o.business_id, r.outlet_id, r.shift_id, r.cashier_id, r.created_at, 'refund', r.id,
  case r.method when 'cash' then 'cash_drawer' when 'qris' then 'qris' else 'receivable_other' end, null, null, null, -r.amount
from public.transaction_refunds r join public.outlets o on o.id = r.outlet_id
union all
select o.business_id, r.outlet_id, r.shift_id, r.cashier_id, r.created_at, 'refund', r.id, x.account, null, ti.product_id, x.qty, x.amount
from public.transaction_refund_items ri
join public.transaction_refunds r on r.id = ri.refund_id
join public.outlets o on o.id = r.outlet_id
join public.transaction_items ti on ti.id = ri.transaction_item_id
cross join lateral (values
  ('sales_return', ri.quantity, ri.amount),
  ('inventory', case when ri.restock then ri.quantity end, case when ri.restock then ri.hpp_amount else 0 end),
  ('cogs', null::numeric, case when ri.restock then -ri.hpp_amount else 0 end)
) as x(account, qty, amount)
where x.amount <> 0
union all
-- Expenses: the cost by category, paid from the drawer or from outside it.
select e.business_id, e.outlet_id, e.shift_id, e.cashier_id, e.created_at, 'expense', e.id, x.account, i.category, null, null, x.amount
from public.expense_items i
join public.expenses e on e.id = i.expense_id
cross join lateral (values
  (case when i.category = 'belanja' then 'purchase' else 'expense' end, i.amount),
  (case when i.paid_from = 'drawer' then 'cash_drawer' else 'cash_outside' end, -i.amount)
) as x(account, amount)
union all
-- Shifts: opening cash into the drawer; at the close the variance is booked and the counted cash leaves the drawer, so a
-- closed shift's drawer is at zero.
select o.business_id, s.outlet_id, s.id, s.cashier_id, s.opened_at, 'shift_open', s.id, x.account, null, null, null, x.amount
from public.shifts s join public.outlets o on o.id = s.outlet_id
cross join lateral (values ('cash_drawer', s.opening_cash), ('cash_outside', -s.opening_cash)) as x(account, amount)
where s.opening_cash <> 0
union all
select o.business_id, s.outlet_id, s.id, s.cashier_id, s.closed_at, 'shift_close', s.id, x.account, null, null, null, x.amount
from public.shifts s join public.outlets o on o.id = s.outlet_id
cross join lateral (values
  ('cash_drawer', coalesce(s.variance, 0)),
  ('cash_variance', -coalesce(s.variance, 0)),
  ('cash_drawer', -coalesce(s.closing_cash, 0)),
  ('cash_outside', coalesce(s.closing_cash, 0))
) as x(account, amount)
where s.status = 'closed' and x.amount <> 0
union all
-- Balancing lines from 071.
select o.business_id, a.outlet_id, a.shift_id, sh.cashier_id, a.effective_at, 'adjustment', a.id, x.account, a.category, null, null, x.amount
from public.shift_adjustments a
join public.outlets o on o.id = a.outlet_id
join public.shifts sh on sh.id = a.shift_id
cross join lateral (values
  (case a.kind when 'cash' then 'cash_drawer' when 'sales' then 'correction_sales' else 'correction_expense' end,
   case a.kind when 'sales' then -a.amount else a.amount end),
  (case a.kind when 'cash' then 'cash_outside' else 'correction_offset' end,
   case a.kind when 'sales' then a.amount else -a.amount end)
) as x(account, amount);

revoke all on public.ledger from public, anon, authenticated;

-- ---------------------------------------------------------------- automatic checks
-- [{ "rule", "ref", "detail" }] for everything out of balance in the business between p_from and p_to; [] when all is well.
-- P1 every document balances; P2 every paid bill adds up (lines, discounts, payment); P3 net sales = cash + QRIS + other
-- (by construction of P1, checked over the period); P4 products add up to the sales; P5 every closed shift's drawer is at
-- zero, its expected cash is its cash book and its variance is counted - expected, and every open shift's ledger matches the
-- cash book the POS reads.
create or replace function public.ledger_checks(p_business uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer set search_path = public as $$
  with l as (select * from public.ledger where business_id = p_business and at >= p_from and at < p_to),
  fails as (
    select 'P1' as rule, doc_id::text as ref, jsonb_build_object('docType', doc_type, 'difference', sum(amount)) as detail
    from l group by doc_type, doc_id having sum(amount) <> 0
    union all
    select 'P2', t.id::text, jsonb_build_object('number', t.number, 'total', t.total,
      'lines', x.gross - x.idisc - t.bill_discount, 'billDiscount', t.bill_discount, 'shares', x.shares, 'paid', p.paid)
    from public.transactions t
    join public.outlets o on o.id = t.outlet_id
    cross join lateral (
      select coalesce(sum(quantity * selling_price_unit), 0) as gross, coalesce(sum(discount_amount), 0) as idisc,
        coalesce(sum(bill_discount_share), 0) as shares
      from public.transaction_items where transaction_id = t.id) x
    cross join lateral (
      select coalesce(sum(amount_received - change_amount), 0) as paid from public.payments where transaction_id = t.id and status = 'paid') p
    where o.business_id = p_business and t.status = 'completed' and t.created_at >= p_from and t.created_at < p_to
      and (t.total <> x.gross - x.idisc - t.bill_discount or x.shares <> t.bill_discount or p.paid <> t.total)
    union all
    select 'P3', null, jsonb_build_object('netSales', n.net, 'received', n.received)
    from (
      select -coalesce(sum(amount) filter (where account in ('sales', 'discount', 'sales_return')), 0) as net,
        coalesce(sum(amount) filter (where doc_type in ('sale', 'void', 'refund') and account in ('cash_drawer', 'qris', 'receivable_other')), 0) as received
      from l) n
    where n.net <> n.received
    union all
    select 'P4', null, jsonb_build_object('netSales', -coalesce(sum(amount), 0), 'byProduct', -coalesce(sum(amount) filter (where product_id is not null), 0))
    from l where account in ('sales', 'discount', 'sales_return')
    having coalesce(sum(amount), 0) <> coalesce(sum(amount) filter (where product_id is not null), 0)
    union all
    select 'P5', s.id::text, jsonb_build_object('shiftNumber', s.shift_number, 'businessDate', s.business_date, 'status', s.status,
      'drawer', d.drawer, 'cashBook', c.book)
    from public.shifts s
    join public.outlets o on o.id = s.outlet_id
    cross join lateral (select coalesce(sum(amount), 0) as drawer from public.ledger where shift_id = s.id and account = 'cash_drawer') d
    cross join lateral (select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) as book
      from public.cash_ledger where shift_id = s.id) c
    where o.business_id = p_business and s.opened_at >= p_from and s.opened_at < p_to
      and ((s.status = 'closed' and (d.drawer <> 0 or s.expected_cash <> c.book or s.variance <> s.closing_cash - s.expected_cash))
        or (s.status = 'open' and d.drawer <> c.book))
  )
  select coalesce(jsonb_agg(jsonb_build_object('rule', rule, 'ref', ref, 'detail', detail) order by rule, ref), '[]'::jsonb) from fails
$$;
revoke all on function public.ledger_checks(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Owner view of the same checks for the signed-in business (the Tutup hari page uses it from stage 4).
create or replace function public.owner_ledger_checks(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business();
begin
  if p_to <= p_from or p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal tidak valid'; end if;
  return public.ledger_checks(b, p_from, p_to);
end $$;
revoke all on function public.owner_ledger_checks(timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_ledger_checks(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------- per-product figures net of every discount
-- The functions below are the current ones (064, 066, 071) with one change: a line's sales are
-- net_subtotal - bill_discount_share, so per-product totals add up to the bill totals.

CREATE OR REPLACE FUNCTION public.get_dashboard_summary(p_cashier_id uuid, p_outlet_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_prev_from timestamp with time zone, p_prev_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
  v_tz text := public.outlet_tz(p_outlet_id);
begin
  perform public.assert_cashier(p_cashier_id,p_outlet_id);
  if p_to <= p_from or p_prev_to <= p_prev_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal terlalu panjang'; end if;

  with tx as (
    select id, total, payment_method, created_at, item_discount, bill_discount
    from public.transactions
    where cashier_id=p_cashier_id and outlet_id=p_outlet_id and status='completed'
      and created_at >= p_from and created_at < p_to
  ),
  totals as (
    select count(*)::int as cnt,
           coalesce(sum(total),0) as sales,
           coalesce(sum(total) filter (where payment_method='cash'),0) as cash,
           coalesce(sum(total) filter (where payment_method='qris'),0) as qris,
           coalesce(sum(item_discount + bill_discount),0) as discount
    from tx
  ),
  refunds as (
    select coalesce(sum(amount),0) as total,
           coalesce(sum(amount) filter (where method='cash'),0) as cash,
           coalesce(sum(amount) filter (where method='qris'),0) as qris
    from public.transaction_refunds
    where cashier_id=p_cashier_id and outlet_id=p_outlet_id and created_at >= p_from and created_at < p_to
  ),
  hourly as (
    select extract(hour from created_at at time zone v_tz)::int as hour, sum(total) as total
    from tx group by 1
  ),
  items as (
    select min(pr.name) as name, pr.station,
           sum(ti.quantity) as qty, sum(ti.net_subtotal - ti.bill_discount_share) as subtotal
    from public.transaction_items ti
    join tx on tx.id=ti.transaction_id
    join public.products pr on pr.id=ti.product_id
    group by lower(btrim(pr.name)), pr.station
  )
  select jsonb_build_object(
    'count',         t.cnt,
    'sales',         t.sales - r.total,
    'cash',          t.cash - r.cash,
    'qris',          t.qris - r.qris,
    'refundTotal',   r.total,
    'discountTotal', t.discount,
    'totalItems',    coalesce((select sum(qty) from items),0),
    'menuCount',     (select count(*) from items),
    'previousSales', coalesce((
      select sum(total) from public.transactions
      where cashier_id=p_cashier_id and outlet_id=p_outlet_id and status='completed'
        and created_at >= p_prev_from and created_at < p_prev_to
    ),0) - coalesce((
      select sum(amount) from public.transaction_refunds
      where cashier_id=p_cashier_id and outlet_id=p_outlet_id and created_at >= p_prev_from and created_at < p_prev_to
    ),0),
    'hourly', coalesce((select jsonb_agg(jsonb_build_object('hour',h.hour,'total',h.total) order by h.hour) from hourly h),'[]'::jsonb),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('name',x.name,'station',x.station,'qty',x.qty,'subtotal',x.subtotal) order by x.qty desc, x.subtotal desc, x.name)
      from (select * from items order by qty desc, subtotal desc, name limit 10) x
    ),'[]'::jsonb)
  ) into result
  from totals t, refunds r;

  return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.get_shift_report(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.shifts%rowtype;
  v_cash jsonb;
  result jsonb;
begin
  select * into s from public.shifts where id=p_shift_id;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(s.cashier_id,s.outlet_id);
  v_cash := public.get_shift_cash_summary(p_shift_id);

  with tx as (
    select id, total, payment_method, subtotal, item_discount, bill_discount
    from public.transactions where shift_id=p_shift_id and status='completed'
  ),
  totals as (
    select count(*)::int as cnt,
           coalesce(sum(total),0) as revenue,
           coalesce(sum(total) filter (where payment_method='cash'),0) as cash,
           coalesce(sum(total) filter (where payment_method='qris'),0) as qris,
           coalesce(sum(subtotal),0) as gross,
           coalesce(sum(item_discount),0) as item_disc,
           coalesce(sum(bill_discount),0) as bill_disc
    from tx
  ),
  voided as (
    select count(*)::int as cnt, coalesce(sum(total),0) as total
    from public.transactions where shift_id=p_shift_id and status='voided'
  ),
  refunds as (
    select count(*)::int as cnt,
           coalesce(sum(amount),0) as total,
           coalesce(sum(amount) filter (where method='cash'),0) as cash,
           coalesce(sum(amount) filter (where method='qris'),0) as qris
    from public.transaction_refunds where shift_id=p_shift_id
  ),
  lines as (
    select coalesce(pr.category_id::text,'uncategorized') as category_id,
           coalesce(c.name,'Tanpa Kategori') as category_name,
           pr.id as product_id, pr.name as product_name,
           sum(ti.quantity) as qty, sum(ti.net_subtotal - ti.bill_discount_share) as total
    from public.transaction_items ti
    join tx on tx.id=ti.transaction_id
    join public.products pr on pr.id=ti.product_id
    left join public.categories c on c.id=pr.category_id
    group by 1,2,3,4
  ),
  cats as (
    select category_id, category_name, sum(qty) as qty, sum(total) as total from lines group by 1,2
  )
  select jsonb_build_object(
    'openingCash',       s.opening_cash,
    'closingCash',       s.closing_cash,
    'variance',          s.variance,
    'totalRevenue',      t.revenue - r.total,
    'cashRevenue',       t.cash - r.cash,
    'qrisRevenue',       t.qris - r.qris,
    'totalTransactions', t.cnt,
    'grossSales',        t.gross,
    'itemDiscount',      t.item_disc,
    'billDiscount',      t.bill_disc,
    'discountTotal',     t.item_disc + t.bill_disc,
    'voidedCount',       v.cnt,
    'voidedTotal',       v.total,
    'refundCount',       r.cnt,
    'refundTotal',       r.total,
    'refundCash',        r.cash,
    'refundQris',        r.qris,
    'totalItems',        coalesce((select sum(qty) from lines),0),
    'expectedCash',      (v_cash->>'expected_cash')::numeric,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'categoryId', ct.category_id,
        'name',       ct.category_name,
        'qty',        ct.qty,
        'total',      ct.total,
        'products', (
          select jsonb_agg(jsonb_build_object('productId',l.product_id,'name',l.product_name,'qty',l.qty,'total',l.total) order by l.total desc, l.product_name)
          from lines l where l.category_id=ct.category_id
        )
      ) order by ct.total desc, ct.category_name)
      from cats ct
    ),'[]'::jsonb)
  ) into result
  from totals t, voided v, refunds r;

  return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.owner_report(p_outlet_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_prev_from timestamp with time zone, p_prev_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      select ti.product_id, sum(ti.quantity) as qty, sum(ti.net_subtotal - ti.bill_discount_share) as sales, sum(ti.quantity * ti.hpp_unit) as hpp
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
end $function$
;

CREATE OR REPLACE FUNCTION public.owner_sales_summary(p_outlet_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_prev_from timestamp with time zone, p_prev_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      select ti.product_id, sum(ti.quantity) as qty, sum(ti.net_subtotal - ti.bill_discount_share) as subtotal
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
end $function$
;

CREATE OR REPLACE FUNCTION public.owner_product_sales(p_outlet_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
  perform public.require_owner_business();
  if not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_to <= p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal terlalu panjang'; end if;

  select coalesce(jsonb_object_agg(x.product_id, jsonb_build_object('qty', x.qty, 'sales', x.sales)), '{}'::jsonb) into result
  from (
    select ti.product_id, sum(ti.quantity) as qty, sum(ti.net_subtotal - ti.bill_discount_share) as sales
    from public.transactions t
    join public.transaction_items ti on ti.transaction_id = t.id
    where t.outlet_id = p_outlet_id and t.status = 'completed' and t.created_at >= p_from and t.created_at < p_to
      and ti.product_id is not null
    group by 1
  ) x;
  return result;
end $function$
;
