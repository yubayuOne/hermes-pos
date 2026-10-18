-- 064: dates and hours in the business's own time zone (audit item 9, 18 Oct 2026). A business can choose WIB, WITA
-- or WIT (031, businesses.timezone), but every date and hour below was still taken in Asia/Jakarta: for a WITA outlet
-- the hourly charts were one hour early, a day ran 01:00 to 01:00, a shift opened after 23:00 WIB got the previous
-- business date, and server-made bill numbers carried the WIB date. Nothing else in these functions changes; their
-- bodies are the current definitions (from 045, 053, 056, 062, 063 and earlier) with the zone replaced.
-- * business_tz / outlet_tz: the zone, Asia/Jakarta when unknown (same default as the column).
-- * Owner summary, dashboard, report: per day and per hour in the business zone.
-- * POS shift and dashboard charts, the shift business date, the reference snapshot's business_date (it now also sends
--   'timezone', which the phone uses for its bill numbers and today's shifts): in the outlet's business zone.
-- * Subscription days left, its notifications, the transfer date check: in the business zone.
-- * Server-made bill numbers (#HPOS-YYYYMMDD-NNNNN, phones without a terminal code): dated in the outlet's zone by the
--   insert trigger of 054, so the many checkout functions that call next_transaction_number() stay as they are.
-- Rows already saved keep their dates. shifts.business_date keeps its WIB column default: every insert sets it.

create or replace function public.business_tz(p_business_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select b.timezone from public.businesses b where b.id = p_business_id), 'Asia/Jakarta')
$$;
create or replace function public.outlet_tz(p_outlet_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select b.timezone from public.outlets o join public.businesses b on b.id = o.business_id where o.id = p_outlet_id), 'Asia/Jakarta')
$$;
revoke all on function public.business_tz(uuid) from public, anon;
revoke all on function public.outlet_tz(uuid) from public, anon;
grant execute on function public.business_tz(uuid) to authenticated;
grant execute on function public.outlet_tz(uuid) to authenticated;

-- 054's insert trigger, plus the zone for numbers the server made.
create or replace function public.trg_transaction_client_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_id text := nullif(current_setting('hermes.client_tx_id', true), '');
  v_number text := nullif(current_setting('hermes.client_tx_number', true), '');
begin
  if v_id is not null then
    new.id := v_id::uuid;
    new.number := v_number;
    -- One bill per call: a second insert in the same request gets the server's own id and number.
    perform set_config('hermes.client_tx_id', '', true);
    perform set_config('hermes.client_tx_number', '', true);
  elsif new.number ~ '^#HPOS-[0-9]{8}-[0-9]+$' then
    -- next_transaction_number() dates in WIB; '#HPOS-' plus 8 digits is 14 characters, the counter follows.
    new.number := '#HPOS-' || to_char(now() at time zone public.outlet_tz(new.outlet_id), 'YYYYMMDD') || substr(new.number, 15);
  end if;
  return new;
end;
$$;
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
           sum(ti.quantity) as qty, sum(ti.net_subtotal) as subtotal
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

CREATE OR REPLACE FUNCTION public.get_shift_dashboard(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.shifts%rowtype;
  result jsonb;
  v_tz text;
begin
  select * into s from public.shifts where id=p_shift_id;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(s.cashier_id,s.outlet_id);
  v_tz := public.outlet_tz(s.outlet_id);

  with tx as (
    select id, total, payment_method, created_at
    from public.transactions
    where shift_id=p_shift_id and status='completed'
  ),
  totals as (
    select count(*)::int                                                    as cnt,
           coalesce(sum(total),0)                                           as sales,
           coalesce(sum(total) filter (where payment_method='cash'),0)      as cash,
           coalesce(sum(total) filter (where payment_method='qris'),0)      as qris
    from tx
  ),
  hourly as (
    select extract(hour from created_at at time zone v_tz)::int as hour,
           sum(total) as total
    from tx
    group by 1
  ),
  items as (
    select pr.id as product_id, pr.name, pr.station,
           sum(ti.quantity) as qty,
           sum(ti.subtotal) as subtotal
    from public.transaction_items ti
    join tx on tx.id=ti.transaction_id
    join public.products pr on pr.id=ti.product_id
    group by pr.id, pr.name, pr.station
  ),
  ranked as (
    select i.*, row_number() over (partition by i.station order by i.subtotal desc, i.name, i.product_id) as rn
    from items i
  )
  select jsonb_build_object(
    'completedCount', t.cnt,
    'sales',          t.sales,
    'cash',           t.cash,
    'qris',           t.qris,
    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object('hour',h.hour,'total',h.total) order by h.hour) from hourly h
    ), '[]'::jsonb),
    'topKitchen', coalesce((
      select jsonb_agg(jsonb_build_object('productId',r.product_id,'productName',r.name,'station',r.station,'qty',r.qty,'subtotal',r.subtotal) order by r.rn)
      from ranked r where r.station='kitchen' and r.rn<=5
    ), '[]'::jsonb),
    'topBar', coalesce((
      select jsonb_agg(jsonb_build_object('productId',r.product_id,'productName',r.name,'station',r.station,'qty',r.qty,'subtotal',r.subtotal) order by r.rn)
      from ranked r where r.station='bar' and r.rn<=5
    ), '[]'::jsonb),
    'best', (
      select jsonb_build_object('productId',i.product_id,'productName',i.name,'station',i.station,'qty',i.qty,'subtotal',i.subtotal)
      from items i order by i.subtotal desc, i.name, i.product_id limit 1
    )
  ) into result
  from totals t;

  return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.get_subscription_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b uuid := public.require_owner_business();
  s record;
  lim record;
  v_days integer;
  v_tz text := public.business_tz(b);
begin
  perform public.refresh_subscription_notifications(b);
  select sub.*, p.name as plan_name, p.is_trial into s from public.subscriptions sub join public.plans p on p.code = sub.plan_code where sub.business_id = b;
  if not found then raise exception 'Langganan tidak ditemukan. Hubungi admin.'; end if;
  select * into lim from public.business_limits(b);
  v_days := greatest(0, (s.expires_at at time zone v_tz)::date - (now() at time zone v_tz)::date);
  return jsonb_build_object(
    'state', case when s.expires_at <= now() then 'expired' when s.is_trial then 'trial' else 'active' end,
    'plan_code', s.plan_code,
    'plan_name', s.plan_name,
    'started_at', s.started_at,
    'expires_at', s.expires_at,
    'days_left', case when s.expires_at <= now() then 0 else v_days end,
    'extra_outlets', s.extra_outlets,
    'limits', jsonb_build_object('outlets', lim.max_outlets, 'cashiers_per_outlet', lim.cashiers_per_outlet, 'products_per_outlet', lim.products_per_outlet),
    'usage', coalesce((
      select jsonb_agg(jsonb_build_object(
        'outlet_id', o.id, 'outlet_name', o.name,
        'active_cashiers', (select count(*) from public.cashier_sessions c where c.outlet_id = o.id and c.is_active),
        'active_products', (select count(*) from public.products p where p.outlet_id = o.id and p.is_active and not p.is_temporary)
      ) order by o.created_at)
      from public.outlets o where o.business_id = b and o.is_active
    ), '[]'::jsonb),
    'unread', (select count(*) from public.notifications n where n.business_id = b and n.read_at is null)
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.open_shift(p_cashier_id uuid, p_outlet_id uuid, p_opening_cash numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  sid uuid;
  v_business_date date := (now() at time zone public.outlet_tz(p_outlet_id))::date;
  v_shift_number integer;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);

  if p_opening_cash < 0 then
    raise exception 'Modal kas tidak valid';
  end if;

  -- Serialize concurrent requests from the same cashier.
  perform pg_advisory_xact_lock(hashtextextended(p_cashier_id::text, 0));

  if exists (
    select 1
    from public.shifts
    where cashier_id = p_cashier_id
      and status = 'open'
  ) then
    raise exception 'Masih ada shift aktif untuk kasir ini';
  end if;

  select coalesce(max(s.shift_number), 0) + 1
    into v_shift_number
  from public.shifts s
  where s.cashier_id = p_cashier_id
    and s.outlet_id = p_outlet_id
    and s.business_date = v_business_date;

  insert into public.shifts (
    cashier_id,
    outlet_id,
    business_date,
    shift_number,
    opening_cash
  )
  values (
    p_cashier_id,
    p_outlet_id,
    v_business_date,
    v_shift_number,
    p_opening_cash
  )
  returning id into sid;

  if p_opening_cash > 0 then
    insert into public.cash_ledger (
      shift_id,
      cashier_id,
      outlet_id,
      direction,
      amount,
      reason,
      source_type,
      source_id
    )
    values (
      sid,
      p_cashier_id,
      p_outlet_id,
      'in',
      p_opening_cash,
      'Modal awal shift',
      'shift_opening',
      sid
    );
  end if;

  return sid;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.open_shift_with_id(p_shift_id uuid, p_cashier_id uuid, p_outlet_id uuid, p_opening_cash numeric, p_opened_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.shifts%rowtype;
  v_opened timestamptz := least(now(), greatest(coalesce(p_opened_at, now()), now() - interval '3 days'));
  v_business_date date := (v_opened at time zone public.outlet_tz(p_outlet_id))::date;
  v_shift_number integer;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);
  if p_shift_id is null then raise exception 'ID shift tidak valid'; end if;
  if p_opening_cash is null or p_opening_cash < 0 then raise exception 'Modal kas tidak valid'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cashier_id::text, 0));

  select * into s from public.shifts where id = p_shift_id;
  if found then
    if s.cashier_id <> p_cashier_id or s.outlet_id <> p_outlet_id then raise exception 'ID shift tidak valid'; end if;
    return s.id;
  end if;

  if exists (select 1 from public.shifts where cashier_id = p_cashier_id and status = 'open') then
    raise exception 'Masih ada shift aktif untuk kasir ini';
  end if;

  select coalesce(max(x.shift_number), 0) + 1 into v_shift_number
  from public.shifts x
  where x.cashier_id = p_cashier_id and x.outlet_id = p_outlet_id and x.business_date = v_business_date;

  insert into public.shifts (id, cashier_id, outlet_id, business_date, shift_number, opening_cash, opened_at, device_id)
  values (p_shift_id, p_cashier_id, p_outlet_id, v_business_date, v_shift_number, p_opening_cash, v_opened, public.request_device_id());

  if p_opening_cash > 0 then
    insert into public.cash_ledger (shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id)
    values (p_shift_id, p_cashier_id, p_outlet_id, 'in', p_opening_cash, 'Modal awal shift', 'shift_opening', p_shift_id);
  end if;

  return p_shift_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.owner_dashboard(p_outlet_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_prev_from timestamp with time zone, p_prev_to timestamp with time zone, p_week_from timestamp with time zone, p_today_from timestamp with time zone, p_today_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.owner_report_page(p_outlet_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_prev_from timestamp with time zone, p_prev_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b uuid := public.require_owner_business();
  v_tz text := public.business_tz(b);
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
  from totals t, rtot r;

  return v_report || jsonb_build_object('sales', v_sales);
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
  from totals t, rtot r;
  return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.owner_submit_payment(p_plan_code text, p_extra_outlets integer, p_sender_name text, p_bank_name text, p_transfer_date date, p_amount_paid bigint, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_business uuid := public.require_owner_business();
  v_today date := (now() at time zone public.business_tz(v_business))::date;
  v_due bigint := public.plan_quote(p_plan_code, coalesce(p_extra_outlets, 0));
  v_row public.payment_confirmations;
begin
  if char_length(trim(coalesce(p_sender_name, ''))) < 2 then raise exception 'Isi nama pengirim sesuai nama di rekening.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_bank_name, ''))) < 2 then raise exception 'Isi nama bank asal transfer.' using errcode = '22023'; end if;
  if p_transfer_date is null or p_transfer_date > v_today then raise exception 'Tanggal transfer tidak boleh setelah hari ini.' using errcode = '22023'; end if;
  if p_transfer_date < v_today - 30 then raise exception 'Tanggal transfer paling lama 30 hari yang lalu.' using errcode = '22023'; end if;
  if coalesce(p_amount_paid, 0) <= 0 then raise exception 'Isi jumlah yang ditransfer.' using errcode = '22023'; end if;
  if exists (select 1 from public.payment_confirmations where business_id = v_business and status = 'submitted') then
    raise exception 'Masih ada konfirmasi pembayaran yang sedang diperiksa.' using errcode = '23505';
  end if;
  insert into public.payment_confirmations(business_id, invoice_number, plan_code, extra_outlets, amount_due, amount_paid,
    sender_name, bank_name, transfer_date, note)
  values (v_business, 'INV-' || to_char(v_today, 'YYYYMMDD') || '-' || lpad(nextval('public.invoice_seq')::text, 5, '0'),
    p_plan_code, coalesce(p_extra_outlets, 0), v_due, p_amount_paid, trim(p_sender_name), trim(p_bank_name),
    p_transfer_date, left(trim(coalesce(p_note, '')), 300))
  returning * into v_row;
  return to_jsonb(v_row) - 'business_id';
end $function$
;

CREATE OR REPLACE FUNCTION public.pos_reference_snapshot(p_outlet_id uuid, p_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'business_date', (now() at time zone public.outlet_tz(p_outlet_id))::date,
    -- The phone dates its bill numbers and today's shifts in this zone (064).
    'timezone', public.outlet_tz(p_outlet_id)
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
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_subscription_notifications(p_business_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s record;
  days integer;
  thresholds integer[];
  t integer;
  pick integer;
  stamp text;
  v_tz text := public.business_tz(p_business_id);
begin
  select sub.*, p.is_trial into s from public.subscriptions sub join public.plans p on p.code = sub.plan_code where sub.business_id = p_business_id;
  if not found then return; end if;
  stamp := to_char(s.expires_at at time zone v_tz, 'YYYY-MM-DD');
  if s.expires_at <= now() then
    insert into public.notifications(business_id, kind, params, dedupe_key)
    values (p_business_id, 'subscription_expired', jsonb_build_object('expires_at', s.expires_at, 'plan_code', s.plan_code), 'expired:' || stamp)
    on conflict (business_id, dedupe_key) do nothing;
    return;
  end if;
  days := (s.expires_at at time zone v_tz)::date - (now() at time zone v_tz)::date;
  thresholds := case when s.is_trial then array[2, 1] else array[30, 21, 14, 7] end;
  foreach t in array thresholds loop
    if days <= t then pick := t; end if;
  end loop;
  if pick is null then return; end if;
  insert into public.notifications(business_id, kind, params, dedupe_key)
  values (p_business_id, case when s.is_trial then 'trial_expiring' else 'subscription_expiring' end,
          jsonb_build_object('days_left', days, 'threshold', pick, 'expires_at', s.expires_at, 'plan_code', s.plan_code),
          'expiring:' || pick || ':' || stamp)
  on conflict (business_id, dedupe_key) do nothing;
end $function$
;
