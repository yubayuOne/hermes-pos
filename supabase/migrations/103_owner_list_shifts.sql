-- 103: the Shift page lists every shift of a period, ten a page (owner's request, 7 Nov 2026). The shape of one shift is
-- the one owner_day_close (075) gives its shifts, so the page's shift card is the same; the business day is added.

-- One shift as the owner sees it. Same keys as owner_day_close's shifts (075), plus its business day.
create or replace function public._shift_json(p_shift_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'shiftNumber', s.shift_number, 'businessDate', s.business_date, 'open', s.status = 'open',
    'openedAt', s.opened_at, 'closedAt', s.closed_at,
    'cashierName', coalesce((select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = s.cashier_id limit 1), 'Kasir dihapus'),
    'bills', (select count(*) from public.transactions t where t.shift_id = s.id and t.status = 'completed'),
    'opening', s.opening_cash,
    'cashSales', x.cash_sales, 'cashRefunds', x.cash_refunds, 'drawerExpenses', x.drawer_expenses,
    'cashIn', x.cash_in, 'cashOut', x.cash_out,
    'expected', case when s.status = 'closed' then s.expected_cash
      else (select coalesce(sum(case when l.direction = 'in' then l.amount else -l.amount end), 0) from public.cash_ledger l where l.shift_id = s.id) end,
    'counted', s.closing_cash, 'variance', s.variance,
    'qrisSales', x.qris_sales, 'qrisRefunds', x.qris_refunds, 'qrisExpected', x.qris_sales - x.qris_refunds,
    'qrisReported', s.qris_reported, 'qrisVariance', s.qris_variance,
    'netSales', x.net_sales,
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'direction', m.direction, 'amount', m.amount, 'reason', m.reason, 'createdAt', m.created_at)
        order by m.created_at, m.id)
      from public.cash_movements m where m.shift_id = s.id), '[]'::jsonb),
    'oldCorrections', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'category', a.category, 'amount', a.amount, 'reason', a.reason, 'createdAt', a.created_at)
        order by a.created_at, a.id)
      from public.shift_adjustments a where a.shift_id = s.id), '[]'::jsonb)
  )
  from public.shifts s
  cross join lateral (
    select
      coalesce(sum(amount) filter (where account = 'cash_drawer' and doc_type in ('sale', 'void')), 0) as cash_sales,
      -coalesce(sum(amount) filter (where account = 'cash_drawer' and doc_type = 'refund'), 0) as cash_refunds,
      -coalesce(sum(amount) filter (where account = 'cash_drawer' and doc_type = 'expense'), 0) as drawer_expenses,
      coalesce(sum(amount) filter (where account = 'cash_drawer' and doc_type = 'cash_movement' and amount > 0), 0) as cash_in,
      -coalesce(sum(amount) filter (where account = 'cash_drawer' and doc_type = 'cash_movement' and amount < 0), 0) as cash_out,
      coalesce(sum(amount) filter (where account = 'qris' and doc_type in ('sale', 'void')), 0) as qris_sales,
      -coalesce(sum(amount) filter (where account = 'qris' and doc_type = 'refund'), 0) as qris_refunds,
      -coalesce(sum(amount) filter (where account in ('sales', 'discount', 'sales_return')), 0) as net_sales
    from public.ledger where shift_id = s.id
  ) x
  where s.id = p_shift_id
$$;
revoke all on function public._shift_json(uuid) from public, anon, authenticated;

-- The shifts of an outlet between two business days, newest first, ten a page. Total counts every shift of the period.
create or replace function public.owner_list_shifts(p_outlet_id uuid, p_from date, p_to date, p_page integer default 1)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  off integer := (greatest(coalesce(p_page, 1), 1) - 1) * 10;
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > 400 then raise exception 'Rentang tanggal terlalu panjang'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.shifts s where s.outlet_id = p_outlet_id and s.business_date between p_from and p_to),
    'rows', coalesce((
      select jsonb_agg(public._shift_json(x.id) order by x.business_date desc, x.opened_at desc, x.id)
      from (
        select s.id, s.business_date, s.opened_at from public.shifts s
        where s.outlet_id = p_outlet_id and s.business_date between p_from and p_to
        order by s.business_date desc, s.opened_at desc, s.id
        limit 10 offset off
      ) x
    ), '[]'::jsonb));
end $$;
revoke all on function public.owner_list_shifts(uuid, date, date, integer) from public, anon;
grant execute on function public.owner_list_shifts(uuid, date, date, integer) to authenticated;
