-- 062: query efficiency for many businesses (audit, 18 Oct 2026). Read paths only; the one delete is old idempotency keys.
-- * RLS: the owner policies called is_owner_of_outlet() once per row of the whole table (a security definer function is
--   never inlined), so a count of "my products" read every business's products. They now test outlet_id against the
--   owner's outlet ids, computed once per query; auth.uid() and my_business_id() are wrapped in a select for the same
--   reason (Supabase RLS performance advice). Who can read what does not change.
-- * owner_shell_counts: the sidebar counts, scoped by business in one call instead of two RLS table counts.
-- * owner_dashboard: the Ringkasan page in one call. Before, the full summary (previous period, top products, cashiers,
--   expenses) ran three times (period, 7 days, today) although the charts only need daily and hourly totals, and the last
--   cash variance sorted every closed shift on the platform.
-- * owner_expense_totals: the period's expenses in one scan; 056 built the whole expense page to read its totals, then
--   scanned the expenses again for drawer / other.
-- * Indexes: cashier_sessions(cashier_id) for the cashier names in reports; closed shifts per outlet for the variance.
-- * checkout_idempotency keys older than 90 days are deleted daily (pg_cron when active). The POS drops a queued sale
--   after 3 days, so no retry can arrive that late.

-- ---------------------------------------------------------------- indexes
create index if not exists cashier_sessions_cashier on public.cashier_sessions(cashier_id);
create index if not exists shifts_outlet_closed on public.shifts(outlet_id, closed_at desc) where status = 'closed';
create index if not exists checkout_idempotency_created on public.checkout_idempotency(created_at);

-- ---------------------------------------------------------------- RLS
-- Same rows as is_owner_of_outlet (028), as a set, so a policy can use it once per query.
create or replace function public.my_owner_outlet_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select o.id from public.outlets o join public.business_members m on m.business_id = o.business_id
  where m.auth_user_id = auth.uid() and m.role = 'owner'
$$;
revoke all on function public.my_owner_outlet_ids() from public, anon;
grant execute on function public.my_owner_outlet_ids() to authenticated;

-- Owner policies (028).
drop policy if exists "owner reads categories" on public.categories;
create policy "owner reads categories" on public.categories for select using (outlet_id in (select public.my_owner_outlet_ids()));
drop policy if exists "owner reads products" on public.products;
create policy "owner reads products" on public.products for select using (outlet_id in (select public.my_owner_outlet_ids()));
drop policy if exists "owner reads shifts" on public.shifts;
create policy "owner reads shifts" on public.shifts for select using (outlet_id in (select public.my_owner_outlet_ids()));
drop policy if exists "owner reads transactions" on public.transactions;
create policy "owner reads transactions" on public.transactions for select using (outlet_id in (select public.my_owner_outlet_ids()));
drop policy if exists "owner reads cash ledger" on public.cash_ledger;
create policy "owner reads cash ledger" on public.cash_ledger for select using (outlet_id in (select public.my_owner_outlet_ids()));
drop policy if exists "owner reads transaction items" on public.transaction_items;
create policy "owner reads transaction items" on public.transaction_items for select using (
  exists (select 1 from public.transactions t where t.id = transaction_items.transaction_id and t.outlet_id in (select public.my_owner_outlet_ids()))
);
drop policy if exists "owner reads payments" on public.payments;
create policy "owner reads payments" on public.payments for select using (
  exists (select 1 from public.transactions t where t.id = payments.transaction_id and t.outlet_id in (select public.my_owner_outlet_ids()))
);

-- Cashier policies (001, 011): same rules, auth.uid() read once per query.
drop policy if exists "cashier session self read" on public.cashier_sessions;
create policy "cashier session self read" on public.cashier_sessions for select using (auth_user_id = (select auth.uid()) and is_active);
drop policy if exists "catalog read" on public.products;
create policy "catalog read" on public.products for select using (
  exists (select 1 from public.cashier_sessions cs where cs.auth_user_id = (select auth.uid()) and cs.outlet_id = products.outlet_id and cs.is_active)
);
drop policy if exists "category read" on public.categories;
create policy "category read" on public.categories for select using (
  exists (select 1 from public.cashier_sessions cs where cs.auth_user_id = (select auth.uid()) and cs.outlet_id = categories.outlet_id and cs.is_active)
);
drop policy if exists "shift own read" on public.shifts;
create policy "shift own read" on public.shifts for select using (
  exists (select 1 from public.cashier_sessions cs
    where cs.auth_user_id = (select auth.uid()) and cs.cashier_id = shifts.cashier_id and cs.outlet_id = shifts.outlet_id and cs.is_active)
);
drop policy if exists "transaction own read" on public.transactions;
create policy "transaction own read" on public.transactions for select using (
  exists (select 1 from public.cashier_sessions cs
    where cs.auth_user_id = (select auth.uid()) and cs.cashier_id = transactions.cashier_id and cs.outlet_id = transactions.outlet_id and cs.is_active)
);
drop policy if exists "transaction item own read" on public.transaction_items;
create policy "transaction item own read" on public.transaction_items for select using (
  exists (select 1 from public.transactions t join public.cashier_sessions cs on cs.cashier_id = t.cashier_id and cs.outlet_id = t.outlet_id
    where t.id = transaction_items.transaction_id and cs.auth_user_id = (select auth.uid()) and cs.is_active)
);
drop policy if exists "payment own read" on public.payments;
create policy "payment own read" on public.payments for select using (
  exists (select 1 from public.transactions t join public.cashier_sessions cs on cs.cashier_id = t.cashier_id and cs.outlet_id = t.outlet_id
    where t.id = payments.transaction_id and cs.auth_user_id = (select auth.uid()) and cs.is_active)
);
drop policy if exists "held own read" on public.held_bills;
create policy "held own read" on public.held_bills for select using (
  exists (select 1 from public.transactions t join public.cashier_sessions cs on cs.cashier_id = t.cashier_id and cs.outlet_id = t.outlet_id
    where t.id = held_bills.transaction_id and cs.auth_user_id = (select auth.uid()) and cs.is_active)
);
drop policy if exists "cashier reads own cash ledger" on public.cash_ledger;
create policy "cashier reads own cash ledger" on public.cash_ledger for select using (
  exists (select 1 from public.cashier_sessions cs
    where cs.auth_user_id = (select auth.uid()) and cs.cashier_id = cash_ledger.cashier_id and cs.outlet_id = cash_ledger.outlet_id and cs.is_active)
);

-- Business, profile and billing policies (027, 030, 031, 032).
drop policy if exists "member reads business" on public.businesses;
create policy "member reads business" on public.businesses for select using (
  exists (select 1 from public.business_members m where m.business_id = businesses.id and m.auth_user_id = (select auth.uid()))
);
drop policy if exists "member reads self" on public.business_members;
create policy "member reads self" on public.business_members for select using (auth_user_id = (select auth.uid()));
drop policy if exists "owner reads outlets" on public.outlets;
create policy "owner reads outlets" on public.outlets for select using (
  business_id in (select m.business_id from public.business_members m where m.auth_user_id = (select auth.uid()))
);
drop policy if exists "owner reads subscription" on public.subscriptions;
create policy "owner reads subscription" on public.subscriptions for select using (business_id = (select public.my_business_id()));
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists vouchers_owner_read on public.vouchers;
create policy vouchers_owner_read on public.vouchers for select to authenticated using (business_id = (select public.my_business_id()));
drop policy if exists voucher_products_owner_read on public.voucher_products;
create policy voucher_products_owner_read on public.voucher_products for select to authenticated
  using (voucher_id in (select v.id from public.vouchers v where v.business_id = (select public.my_business_id())));
drop policy if exists payments_owner_read on public.payment_confirmations;
create policy payments_owner_read on public.payment_confirmations for select to authenticated using (business_id = (select public.my_business_id()));
drop policy if exists voucher_redemptions_owner_read on public.voucher_redemptions;
create policy voucher_redemptions_owner_read on public.voucher_redemptions for select to authenticated
  using (voucher_id in (select v.id from public.vouchers v where v.business_id = (select public.my_business_id())));

-- ---------------------------------------------------------------- sidebar counts
create or replace function public.owner_shell_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business();
begin
  return jsonb_build_object(
    'products', (select count(*) from public.products p join public.outlets o on o.id = p.outlet_id where o.business_id = b and not p.is_temporary),
    'vouchers', (select count(*) from public.vouchers v where v.business_id = b)
  );
end $$;
revoke all on function public.owner_shell_counts() from public, anon;
grant execute on function public.owner_shell_counts() to authenticated;

-- ---------------------------------------------------------------- expenses of a period
-- Same rows and totals as owner_list_expenses 'totals' (045), plus drawer / other, in one scan. Internal: the caller
-- has already checked the owner and the outlet.
create or replace function public.owner_expense_totals(p_business uuid, p_outlet_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', coalesce(sum(i.amount), 0),
    'operasional', coalesce(sum(i.amount) filter (where i.category = 'operasional'), 0),
    'belanja', coalesce(sum(i.amount) filter (where i.category = 'belanja'), 0),
    'drawer', coalesce(sum(i.amount) filter (where i.paid_from = 'drawer'), 0),
    'other', coalesce(sum(i.amount) filter (where i.paid_from = 'other'), 0))
  from public.expenses e join public.expense_items i on i.expense_id = e.id
  where e.business_id = p_business and (p_outlet_id is null or e.outlet_id = p_outlet_id)
    and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to)
$$;
revoke all on function public.owner_expense_totals(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- 056 kept for web builds deployed before this one; same result, one expense scan.
create or replace function public.owner_summary_with_expenses(
  p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_sales jsonb := public.owner_sales_summary(p_outlet_id, p_from, p_to, p_prev_from, p_prev_to);
  v_exp jsonb := public.owner_expense_totals(b, p_outlet_id, p_from, p_to);
begin
  return v_sales || jsonb_build_object(
    'expenses', v_exp,
    'salesAfterExpenses', coalesce((v_sales ->> 'sales')::numeric, 0) - (v_exp ->> 'total')::numeric
  );
end $$;

-- ---------------------------------------------------------------- Ringkasan in one call
-- period: owner_sales_summary + expenses (as 056). week: net sales and bills per day from p_week_from to p_today_to.
-- today: gross sales per hour from p_today_from (as owner_sales_summary 'hourly'). lastVariance: newest closed shift.
create or replace function public.owner_dashboard(
  p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz,
  p_week_from timestamptz, p_today_from timestamptz, p_today_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
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
  )
  select
    jsonb_build_object(
      'count', coalesce((select sum(bill) from moves), 0)::int,
      'sales', coalesce((select sum(amount) from moves), 0),
      'daily', coalesce((
        select jsonb_agg(jsonb_build_object('date', d.day, 'count', d.cnt, 'total', d.total) order by d.day)
        from (select (created_at at time zone 'Asia/Jakarta')::date as day, sum(bill)::int as cnt, sum(amount) as total from moves group by 1) d
      ), '[]'::jsonb)),
    jsonb_build_object('hourly', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'total', h.total) order by h.hour)
      from (
        select extract(hour from created_at at time zone 'Asia/Jakarta')::int as hour, sum(total) as total
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
revoke all on function public.owner_dashboard(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_dashboard(uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------- old idempotency keys
-- Internal: called by pg_cron, not by clients.
create or replace function public.cleanup_checkout_idempotency()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.checkout_idempotency where created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.cleanup_checkout_idempotency() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'hermes-pos-cleanup-idempotency') then
      perform cron.unschedule('hermes-pos-cleanup-idempotency');
    end if;
    -- 21:00 UTC = 04:00 WIB, after the other cleanups.
    perform cron.schedule('hermes-pos-cleanup-idempotency', '0 21 * * *', 'select public.cleanup_checkout_idempotency()');
  end if;
end $$;
