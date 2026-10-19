-- Bookkeeping, stage 4 (docs/ACCOUNTING.md sections 4.4, 5, 6.1): QRIS reconciled at shift close, days closed and locked.
--
-- 1) close_shift_at takes the QRIS total the cashier reads from the merchant app (p_qris_reported). The shift stores the
--    QRIS it should have (QRIS sales - QRIS refunds of the shift) and the difference, like cash. Older apps send nothing:
--    the shift then has no QRIS count.
-- 2) The owner closes a day per outlet (Tutup hari): every shift of that business date closed and every check clean.
--    The owner may enter the QRIS that reached the bank; what is left of the day's QRIS becomes a QRIS difference.
-- 3) A closed day is locked in the database itself: its bills, payments, cash book, shifts, and expenses cannot change
--    by any path. The owner can reopen a day with a reason; closing and reopening are logged.
-- 4) report_pnl adds stock adjustments, cash differences, and QRIS differences (from the ledger) to the operating profit.

-- ---------------------------------------------------------------- 1) QRIS at shift close
alter table public.shifts
  add column if not exists qris_reported numeric(14,2),
  add column if not exists qris_expected numeric(14,2),
  add column if not exists qris_variance numeric(14,2);

drop function if exists public.close_shift_at(uuid, numeric, timestamptz);
-- Same as 050/051 plus the QRIS count. Resending the same close returns the stored result.
create or replace function public.close_shift_at(p_shift_id uuid, p_physical_cash numeric, p_closed_at timestamptz default null,
  p_qris_reported numeric default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shifts%rowtype;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_expected_cash numeric := 0;
  v_variance_amount numeric := 0;
  v_qris_expected numeric := 0;
  v_held_count integer := 0;
  v_closed timestamptz;
begin
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(v_shift.cashier_id, v_shift.outlet_id);
  if p_physical_cash is null or p_physical_cash < 0 then raise exception 'Kas fisik tidak valid'; end if;
  if p_qris_reported is not null and p_qris_reported < 0 then raise exception 'Total QRIS tidak valid'; end if;

  select
    coalesce(sum(case when direction = 'in' then amount else 0 end), 0),
    coalesce(sum(case when direction = 'out' then amount else 0 end), 0)
  into v_cash_in, v_cash_out
  from public.cash_ledger where shift_id = v_shift.id;

  if v_shift.status <> 'open' then
    if v_shift.closing_cash = p_physical_cash then
      return jsonb_build_object('expected_cash', v_shift.expected_cash, 'variance', v_shift.variance, 'cash_in', v_cash_in, 'cash_out', v_cash_out,
        'qris_expected', v_shift.qris_expected, 'qris_reported', v_shift.qris_reported, 'qris_variance', v_shift.qris_variance);
    end if;
    raise exception 'Shift sudah ditutup';
  end if;
  perform public.assert_shift_device(v_shift.device_id);

  select count(*)::integer into v_held_count from public.transactions t where t.shift_id = v_shift.id and t.status = 'held';
  if v_held_count > 0 then
    raise exception 'Masih ada % Bill Ditahan. Selesaikan atau batalkan Bill Ditahan sebelum menutup shift.', v_held_count;
  end if;

  v_expected_cash := v_cash_in - v_cash_out;
  v_variance_amount := p_physical_cash - v_expected_cash;
  v_qris_expected := public.shift_qris_expected(v_shift.id);
  v_closed := least(now(), greatest(coalesce(p_closed_at, now()), v_shift.opened_at));

  update public.shifts
  set closed_at = v_closed, closing_cash = p_physical_cash, expected_cash = v_expected_cash, variance = v_variance_amount, status = 'closed',
      qris_expected = v_qris_expected, qris_reported = p_qris_reported,
      qris_variance = case when p_qris_reported is null then null else p_qris_reported - v_qris_expected end
  where id = v_shift.id;

  return jsonb_build_object('expected_cash', v_expected_cash, 'variance', v_variance_amount, 'cash_in', v_cash_in, 'cash_out', v_cash_out,
    'qris_expected', v_qris_expected, 'qris_reported', p_qris_reported,
    'qris_variance', case when p_qris_reported is null then null else p_qris_reported - v_qris_expected end);
end $$;
revoke all on function public.close_shift_at(uuid, numeric, timestamptz, numeric) from public, anon;
grant execute on function public.close_shift_at(uuid, numeric, timestamptz, numeric) to authenticated;

-- QRIS the shift should have received, from the ledger: its QRIS bills less the QRIS refunds made in it.
create or replace function public.shift_qris_expected(p_shift_id uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.ledger where shift_id = p_shift_id and account = 'qris' and doc_type in ('sale', 'void', 'refund')
$$;
revoke all on function public.shift_qris_expected(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2) closing a day
create table if not exists public.day_closes (
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  business_date date not null,
  -- The day's QRIS by the books at closing (sales - refunds + shift QRIS differences) and what reached the bank (null:
  -- not entered, the QRIS stays pending).
  qris_book numeric(14,2) not null default 0,
  qris_settled numeric(14,2) check (qris_settled is null or qris_settled >= 0),
  note text not null default '' check (char_length(note) <= 200),
  closed_by uuid,
  closed_at timestamptz not null default now(),
  primary key (outlet_id, business_date)
);
create table if not exists public.day_close_log (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  business_date date not null,
  action text not null check (action in ('close', 'reopen')),
  reason text not null default '',
  qris_settled numeric(14,2),
  by_user uuid,
  at timestamptz not null default now()
);
alter table public.day_closes enable row level security;
alter table public.day_close_log enable row level security;
revoke all on public.day_closes from public, anon, authenticated;
revoke all on public.day_close_log from public, anon, authenticated;

create or replace function public.day_locked(p_outlet uuid, p_date date)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.day_closes where outlet_id = p_outlet and business_date = p_date)
$$;
create or replace function public.shift_day_locked(p_shift_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shifts s join public.day_closes d on d.outlet_id = s.outlet_id and d.business_date = s.business_date
                 where s.id = p_shift_id)
$$;
revoke all on function public.day_locked(uuid, date) from public, anon, authenticated;
revoke all on function public.shift_day_locked(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3) the lock, enforced on the tables
create or replace function public.raise_day_locked()
returns void
language plpgsql as $$
begin
  raise exception 'Hari itu sudah ditutup dan dikunci. Buka kuncinya dulu di Tutup hari, atau catat koreksinya di hari yang masih buka.'
    using errcode = 'P0001', hint = 'day_locked';
end $$;

create or replace function public.trg_lock_cash_ledger()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.shift_day_locked(case when tg_op = 'DELETE' then old.shift_id else new.shift_id end)
     or (tg_op = 'UPDATE' and public.shift_day_locked(old.shift_id)) then
    perform public.raise_day_locked();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists cash_ledger_day_lock on public.cash_ledger;
create trigger cash_ledger_day_lock before insert or update or delete on public.cash_ledger
  for each row execute function public.trg_lock_cash_ledger();

create or replace function public.trg_lock_shift()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.day_locked(old.outlet_id, old.business_date)
     and (new.status, new.closing_cash, new.expected_cash, new.variance, new.qris_reported, new.qris_variance, new.business_date)
         is distinct from (old.status, old.closing_cash, old.expected_cash, old.variance, old.qris_reported, old.qris_variance, old.business_date) then
    perform public.raise_day_locked();
  end if;
  return new;
end $$;
drop trigger if exists shift_day_lock on public.shifts;
create trigger shift_day_lock before update on public.shifts for each row execute function public.trg_lock_shift();

create or replace function public.trg_lock_transaction()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.shift_day_locked(new.shift_id)
     and (tg_op = 'INSERT' or (new.status, new.total, new.payment_method, new.shift_id) is distinct from (old.status, old.total, old.payment_method, old.shift_id)) then
    perform public.raise_day_locked();
  end if;
  return new;
end $$;
drop trigger if exists transaction_day_lock on public.transactions;
create trigger transaction_day_lock before insert or update on public.transactions for each row execute function public.trg_lock_transaction();

create or replace function public.trg_lock_expense_item()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.shift_day_locked((select shift_id from public.expenses where id = case when tg_op = 'DELETE' then old.expense_id else new.expense_id end)) then
    perform public.raise_day_locked();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists expense_item_day_lock on public.expense_items;
create trigger expense_item_day_lock before insert or update or delete on public.expense_items for each row execute function public.trg_lock_expense_item();
revoke all on function public.trg_lock_cash_ledger() from public, anon, authenticated;
revoke all on function public.trg_lock_shift() from public, anon, authenticated;
revoke all on function public.trg_lock_transaction() from public, anon, authenticated;
revoke all on function public.trg_lock_expense_item() from public, anon, authenticated;

-- ---------------------------------------------------------------- the owner closes and reopens days
create or replace function public.owner_close_day(p_outlet_id uuid, p_date date, p_qris_settled numeric, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_note text := btrim(coalesce(p_note, ''));
  v_book numeric;
  v_checks jsonb;
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('menutup hari'); end if;
  v_tz := public.outlet_tz(p_outlet_id);
  if p_date is null or p_date > (now() at time zone v_tz)::date then raise exception 'Tanggal tidak valid'; end if;
  if p_qris_settled is not null and (p_qris_settled < 0 or p_qris_settled <> round(p_qris_settled)) then raise exception 'QRIS masuk rekening tidak valid'; end if;
  if char_length(v_note) > 200 then raise exception 'Catatan maksimal 200 karakter'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text || p_date::text, 0));
  if public.day_locked(p_outlet_id, p_date) then raise exception 'Hari itu sudah ditutup'; end if;
  if exists (select 1 from public.shifts where outlet_id = p_outlet_id and business_date = p_date and status = 'open') then
    raise exception 'Masih ada shift yang belum ditutup kasir. Tutup semua shift dulu.';
  end if;

  select coalesce(min(opened_at), (p_date::timestamp at time zone v_tz)) into v_from from public.shifts where outlet_id = p_outlet_id and business_date = p_date;
  v_to := now() + interval '1 second';
  v_checks := public.ledger_checks(b, p_outlet_id, v_from, v_to);
  if v_checks <> '[]'::jsonb then
    raise exception 'Masih ada angka yang tidak cocok. Hari ini belum bisa ditutup; lihat pemeriksaan di halaman ini.';
  end if;

  select coalesce(sum(l.amount), 0) into v_book
  from public.ledger l join public.shifts s on s.id = l.shift_id
  where s.outlet_id = p_outlet_id and s.business_date = p_date and l.account = 'qris';

  insert into public.day_closes(outlet_id, business_date, qris_book, qris_settled, note, closed_by)
  values (p_outlet_id, p_date, v_book, p_qris_settled, v_note, auth.uid());
  insert into public.day_close_log(outlet_id, business_date, action, reason, qris_settled, by_user)
  values (p_outlet_id, p_date, 'close', v_note, p_qris_settled, auth.uid());
  return public.owner_day_close(p_outlet_id, p_date);
end $$;

create or replace function public.owner_reopen_day(p_outlet_id uuid, p_date date, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if char_length(v_reason) < 3 then raise exception 'Alasan wajib diisi, minimal 3 karakter'; end if;
  if char_length(v_reason) > 200 then raise exception 'Alasan maksimal 200 karakter'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('membuka kunci hari'); end if;
  delete from public.day_closes where outlet_id = p_outlet_id and business_date = p_date;
  if not found then raise exception 'Hari itu belum ditutup'; end if;
  insert into public.day_close_log(outlet_id, business_date, action, reason, by_user) values (p_outlet_id, p_date, 'reopen', v_reason, auth.uid());
  return public.owner_day_close(p_outlet_id, p_date);
end $$;
revoke all on function public.owner_close_day(uuid, date, numeric, text) from public, anon;
revoke all on function public.owner_reopen_day(uuid, date, text) from public, anon;
grant execute on function public.owner_close_day(uuid, date, numeric, text) to authenticated;
grant execute on function public.owner_reopen_day(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------- the Tutup hari data with QRIS and the lock
-- Same as 073 plus each shift's QRIS count and difference, the day's lock and its log, and the day's correction trail.
create or replace function public.owner_day_close(p_outlet_id uuid, p_date date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_date is null then raise exception 'Pilih tanggal'; end if;
  v_tz := public.outlet_tz(p_outlet_id);
  select coalesce(min(opened_at), (p_date::timestamp at time zone v_tz)) into v_from from public.shifts where outlet_id = p_outlet_id and business_date = p_date;
  v_to := greatest(now(), ((p_date + 1)::timestamp at time zone v_tz)) + interval '1 second';

  return jsonb_build_object(
    'date', p_date,
    'closed', (select jsonb_build_object('closedAt', d.closed_at, 'qrisBook', d.qris_book, 'qrisSettled', d.qris_settled,
                 'qrisDifference', case when d.qris_settled is null then null else d.qris_settled - d.qris_book end, 'note', d.note)
               from public.day_closes d where d.outlet_id = p_outlet_id and d.business_date = p_date),
    'log', coalesce((select jsonb_agg(jsonb_build_object('action', g.action, 'reason', g.reason, 'qrisSettled', g.qris_settled, 'at', g.at) order by g.at)
                     from public.day_close_log g where g.outlet_id = p_outlet_id and g.business_date = p_date), '[]'::jsonb),
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'shiftNumber', s.shift_number, 'open', s.status = 'open', 'openedAt', s.opened_at, 'closedAt', s.closed_at,
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
      ) order by s.opened_at, s.id)
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
      where s.outlet_id = p_outlet_id and s.business_date = p_date
    ), '[]'::jsonb),
    -- Everything of the day that undid or changed something, for the owner to review before locking: voids, bill
    -- corrections, refunds, cancelled expenses, and stock losses and counts (by the outlet's calendar day).
    'trail', coalesce((
      select jsonb_agg(e order by e ->> 'at')
      from (
        select jsonb_build_object('kind', case when t.void_reason like 'Dikoreksi:%' then 'correction' else 'void' end,
          'at', coalesce(t.voided_at, t.created_at), 'ref', t.number, 'amount', t.total,
          'reason', regexp_replace(coalesce(t.void_reason, ''), '^Dikoreksi: ', '')) as e
        from public.transactions t join public.shifts s on s.id = t.shift_id
        where s.outlet_id = p_outlet_id and s.business_date = p_date and t.status = 'voided'
        union all
        select jsonb_build_object('kind', 'refund', 'at', r.created_at, 'ref', t.number, 'amount', r.amount, 'reason', r.reason)
        from public.transaction_refunds r join public.transactions t on t.id = r.transaction_id join public.shifts s on s.id = r.shift_id
        where s.outlet_id = p_outlet_id and s.business_date = p_date
        union all
        select jsonb_build_object('kind', 'expense_cancel', 'at', c.cancelled_at, 'ref', c.name, 'amount', c.amount, 'reason', c.reason)
        from public.expense_item_cancellations c join public.expenses e on e.id = c.expense_id join public.shifts s on s.id = e.shift_id
        where s.outlet_id = p_outlet_id and s.business_date = p_date
        union all
        select jsonb_build_object('kind', 'stock_' || d.kind, 'at', d.created_at, 'ref', null, 'amount', (select coalesce(sum(l.qty * l.hpp_unit), 0)
          from public.stock_document_lines l where l.document_id = d.id), 'reason', d.reason)
        from public.stock_documents d
        where d.outlet_id = p_outlet_id and d.kind in ('adjustment', 'opname')
          and d.created_at >= (p_date::timestamp at time zone v_tz) and d.created_at < ((p_date + 1)::timestamp at time zone v_tz)
      ) x
    ), '[]'::jsonb),
    'checks', public.ledger_checks(b, p_outlet_id, v_from, v_to)
  );
end $$;

-- ---------------------------------------------------------------- the ledger with QRIS counts and bank settlement
-- Same as 074 plus: at a shift's close its QRIS difference (qris / qris_variance); at a day's close the QRIS that reached
-- the bank (bank / qris) and what was left (qris_variance).
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
select business_id, outlet_id, shift_id, cashier_id, void_posted_at, 'void', doc_id, account, category, product_id, -qty, -amount
from sale_lines where void_posted_at is not null
union all
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
select e.business_id, e.outlet_id, e.shift_id, e.cashier_id, e.created_at, 'expense', e.id, x.account, i.category, null, null, x.amount
from public.expense_items i
join public.expenses e on e.id = i.expense_id
cross join lateral (values
  (case when i.category = 'belanja' then 'purchase' else 'expense' end, i.amount),
  (case when i.paid_from = 'drawer' then 'cash_drawer' else 'cash_outside' end, -i.amount)
) as x(account, amount)
union all
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
  ('cash_outside', coalesce(s.closing_cash, 0)),
  ('qris', coalesce(s.qris_variance, 0)),
  ('qris_variance', -coalesce(s.qris_variance, 0))
) as x(account, amount)
where s.status = 'closed' and x.amount <> 0
union all
select o.business_id, m.outlet_id, m.shift_id, sh.cashier_id, m.created_at, 'cash_movement', m.id, x.account, null, null, null, x.amount
from public.cash_movements m
join public.outlets o on o.id = m.outlet_id
join public.shifts sh on sh.id = m.shift_id
cross join lateral (values
  ('cash_drawer', case m.direction when 'in' then m.amount else -m.amount end),
  ('cash_outside', case m.direction when 'in' then -m.amount else m.amount end)
) as x(account, amount)
union all
select o.business_id, a.outlet_id, a.shift_id, sh.cashier_id, a.effective_at, 'adjustment', a.id, x.account, a.category, null, null, x.amount
from public.shift_adjustments a
join public.outlets o on o.id = a.outlet_id
join public.shifts sh on sh.id = a.shift_id
cross join lateral (values
  (case a.kind when 'sales' then 'correction_sales' else 'correction_expense' end, case a.kind when 'sales' then -a.amount else a.amount end),
  ('correction_offset', case a.kind when 'sales' then a.amount else -a.amount end)
) as x(account, amount)
union all
select o.business_id, d.outlet_id, null::uuid, null::uuid, d.created_at, 'stock_' || d.kind, d.id, x.account, null, l.product_id, x.qty, x.amount
from public.stock_document_lines l
join public.stock_documents d on d.id = l.document_id
join public.outlets o on o.id = d.outlet_id
cross join lateral (values
  ('inventory', l.qty, l.qty * l.hpp_unit),
  (case d.kind when 'stock_in' then 'cost_absorbed' when 'adjustment' then 'stock_adjustment' when 'opname' then 'stock_adjustment' else 'opening_balance' end,
   null::numeric, -(l.qty * l.hpp_unit))
) as x(account, qty, amount)
where l.qty * l.hpp_unit <> 0
union all
-- A closed day with the bank's QRIS entered: the money moves to the bank; what the books expected but did not arrive (or
-- arrived on top) is a QRIS difference. Keyed by the outlet's day, not a shift.
select o.business_id, d.outlet_id, null::uuid, null::uuid, d.closed_at, 'day_close', null::uuid, x.account, null, null, null, x.amount
from public.day_closes d
join public.outlets o on o.id = d.outlet_id
cross join lateral (values
  ('bank', d.qris_settled),
  ('qris', -d.qris_book),
  ('qris_variance', d.qris_book - d.qris_settled)
) as x(account, amount)
where d.qris_settled is not null and x.amount <> 0;
revoke all on public.ledger from public, anon, authenticated;

-- ---------------------------------------------------------------- 4) P&L with the ledger's differences
-- Same as 071 plus stock adjustments (losses and count differences), cash differences, and QRIS differences of the period
-- (a surplus is a gain); all three are in the operating profit.
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
  ), led as (
    select coalesce(sum(l.amount) filter (where l.account = 'stock_adjustment'), 0) as stock_adj,
      -coalesce(sum(l.amount) filter (where l.account = 'cash_variance'), 0) as cash_var,
      -coalesce(sum(l.amount) filter (where l.account = 'qris_variance'), 0) as qris_var
    from public.ledger l join scope s on s.id = l.outlet_id
    where l.business_id = p_business and l.at >= p_from and l.at < p_to and l.account in ('stock_adjustment', 'cash_variance', 'qris_variance')
  )
  select jsonb_build_object(
    'grossSales', tx.sales + tx.discounts, 'discounts', tx.discounts, 'refunds', rf.total, 'adjustments', adj.sales,
    'netSales', tx.sales - rf.total + adj.sales,
    'count', tx.cnt, 'hpp', tx.hpp - rf.restock_hpp, 'grossProfit', (tx.sales - rf.total + adj.sales) - (tx.hpp - rf.restock_hpp),
    'operatingExpenses', ex.opex + adj.opex, 'inventoryPurchases', ex.inventory + adj.inventory,
    'stockAdjustments', led.stock_adj, 'cashDifference', led.cash_var, 'qrisDifference', led.qris_var,
    'operatingProfit', (tx.sales - rf.total + adj.sales) - (tx.hpp - rf.restock_hpp) - (ex.opex + adj.opex)
      - led.stock_adj + led.cash_var + led.qris_var)
  from tx, rf, ex, adj, led
$$;
