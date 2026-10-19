-- Bookkeeping, stage 2 (docs/ACCOUNTING.md sections 4 and 6): mistakes are fixed with documents, never by changing numbers.
--
-- 1) Koreksi bill: the owner voids a paid bill and records the right one in the same step. The new bill keeps the
--    original's day, shift, cashier, unit prices, and discounts; it points back with corrects_transaction_id. Items,
--    quantities, products, payment method, name, and table can all change. Stock, cash, QRIS, and every report follow.
-- 2) Uang masuk / keluar laci: cash put into or taken out of a drawer that is not a sale or an expense (small change,
--    the owner taking money), with a reason. The 071 cash lines become these; new 071 lines can no longer be made, and
--    its sales and expense lines stay as "koreksi lama" (old corrections).
-- 3) Pengeluaran: the owner cancels an item (it moves to expense_item_cancellations with the reason, so it no longer
--    counts anywhere but stays on record) and adds items to any shift.
-- 4) owner_day_close(outlet, date): the Tutup hari page, one reconciliation per shift from the ledger.
-- 5) ledger_checks takes an outlet.

-- ---------------------------------------------------------------- 1) bill correction
alter table public.transactions add column if not exists corrects_transaction_id uuid references public.transactions(id);
create index if not exists transactions_corrects on public.transactions(corrects_transaction_id) where corrects_transaction_id is not null;
alter table public.transaction_edits drop constraint if exists transaction_edits_kind_check;
alter table public.transaction_edits add constraint transaction_edits_kind_check
  check (kind in ('void', 'payment', 'details', 'items', 'correction'));

-- p_items: the whole new list. [{"itemId", "quantity"}] keeps a line of the original bill at its price and discount (0 or
-- left out drops it); [{"productId", "quantity"}] adds a product at today's catalog price.
create or replace function public.owner_correct_bill(p_transaction_id uuid, p_items jsonb, p_payment_method public.payment_method,
  p_customer_name text, p_table_number text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := public._067_reason(p_reason);
  v_name text := btrim(coalesce(p_customer_name, ''));
  v_table text := btrim(coalesce(p_table_number, ''));
  v_before jsonb;
  t public.transactions%rowtype;
  v_new uuid;
  v_number text;
  v_gross numeric;
  v_idisc numeric;
  v_hpp numeric;
  v_total numeric;
begin
  if p_payment_method is null or p_payment_method not in ('cash', 'qris') then raise exception 'Metode bayar tidak valid'; end if;
  if char_length(v_name) > 40 then raise exception 'Nama pelanggan maksimal 40 karakter'; end if;
  if char_length(v_table) > 6 then raise exception 'Nomor meja maksimal 6 karakter'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Isi minimal satu item'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Maksimal 200 item'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where jsonb_typeof(e) <> 'object' or (e ? 'itemId') = (e ? 'productId')
               or coalesce(e->>'itemId', e->>'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               or coalesce(e->>'quantity', '') !~ '^[0-9]{1,4}$') then
    raise exception 'Data item tidak valid';
  end if;

  v_before := public._067_begin(p_transaction_id);
  select * into t from public.transactions where id = p_transaction_id;
  if t.status <> 'completed' then raise exception 'Hanya bill yang sudah dibayar yang bisa dikoreksi.'; end if;
  if t.parent_transaction_id is not null then
    raise exception 'Bill hasil Split Bill tidak bisa dikoreksi. Batalkan bill ini lalu catat ulang di aplikasi kasir.';
  end if;
  if t.refunded_total > 0 then raise exception 'Bill yang sudah direfund tidak bisa dikoreksi.'; end if;
  if exists (select 1 from public.voucher_redemptions where transaction_id = t.id) then
    raise exception 'Bill yang memakai voucher tidak bisa dikoreksi. Batalkan bill ini lalu catat ulang di aplikasi kasir.';
  end if;

  create temporary table if not exists pg_temp.tmp_073_lines (item_id uuid, product_id uuid, quantity numeric) on commit drop;
  truncate pg_temp.tmp_073_lines;
  insert into pg_temp.tmp_073_lines
  select (e->>'itemId')::uuid, (e->>'productId')::uuid, (e->>'quantity')::numeric from jsonb_array_elements(p_items) e;
  if (select count(item_id) <> count(distinct item_id) from pg_temp.tmp_073_lines) then raise exception 'Data item tidak valid'; end if;
  if exists (select 1 from pg_temp.tmp_073_lines l where l.item_id is not null
             and not exists (select 1 from public.transaction_items ti where ti.id = l.item_id and ti.transaction_id = t.id)) then
    raise exception 'Item tidak ada di bill ini';
  end if;
  if exists (select 1 from pg_temp.tmp_073_lines l where l.product_id is not null and l.quantity > 0
             and not exists (select 1 from public.products p where p.id = l.product_id and p.outlet_id = t.outlet_id and p.is_active)) then
    raise exception 'Produk tidak ditemukan atau sudah tidak aktif';
  end if;

  -- The original goes first: its stock comes back, its payment leaves the cash book.
  perform public._066_void_bill(t.id, 'Dikoreksi: ' || v_reason);

  insert into public.transactions(shift_id, cashier_id, outlet_id, number, customer_name, customer_phone, table_number, status,
    created_at, corrects_transaction_id)
  values (t.shift_id, t.cashier_id, t.outlet_id, public.next_transaction_number(), v_name, t.customer_phone, v_table, 'draft',
    t.created_at, t.id)
  returning id, number into v_new, v_number;
  -- The number carries the bill's own day, like the bill it replaces.
  v_number := '#HPOS-' || to_char(t.created_at at time zone public.outlet_tz(t.outlet_id), 'YYYYMMDD') || substr(v_number, 15);
  update public.transactions set number = v_number where id = v_new;

  insert into public.transaction_items(transaction_id, product_id, quantity, hpp_unit, selling_price_unit, discount_amount,
    discount_type, discount_value, note)
  select v_new, ti.product_id, l.quantity, ti.hpp_unit, ti.selling_price_unit, x.amount,
    case when x.amount > 0 then ti.discount_type end,
    case when x.amount > 0 then (case when ti.discount_type = 'amount' then x.amount else ti.discount_value end) end,
    ti.note
  from pg_temp.tmp_073_lines l
  join public.transaction_items ti on ti.id = l.item_id
  cross join lateral (select case ti.discount_type
      when 'percent' then public.calc_discount(l.quantity * ti.selling_price_unit, 'percent', ti.discount_value)
      when 'amount' then least(ti.discount_value, l.quantity * ti.selling_price_unit)
      else 0 end as amount) x
  where l.quantity > 0;
  insert into public.transaction_items(transaction_id, product_id, quantity, hpp_unit, selling_price_unit)
  select v_new, p.id, x.qty, p.hpp, p.selling_price
  from (select product_id, sum(quantity) as qty from pg_temp.tmp_073_lines where product_id is not null group by 1) x
  join public.products p on p.id = x.product_id
  where x.qty > 0
  order by p.id;

  if exists (select 1 from public.products p
             join (select product_id, sum(quantity) as qty from public.transaction_items where transaction_id = v_new group by 1) x on x.product_id = p.id
             where p.track_stock and p.stock < x.qty) then
    raise exception 'Stok produk tidak mencukupi';
  end if;
  update public.products p set stock = p.stock - x.qty
  from (select product_id, sum(quantity) as qty from public.transaction_items where transaction_id = v_new group by 1) x
  where p.id = x.product_id and p.track_stock;

  select coalesce(sum(quantity * selling_price_unit), 0), coalesce(sum(discount_amount), 0), coalesce(sum(quantity * hpp_unit), 0)
    into v_gross, v_idisc, v_hpp
  from public.transaction_items where transaction_id = v_new;
  v_total := public.set_bill_totals(v_new, v_gross, v_idisc, t.bill_discount_type, t.bill_discount_value);
  update public.transactions
  set total_hpp = v_hpp, payment_method = p_payment_method, status = 'completed', completed_at = coalesce(t.completed_at, now())
  where id = v_new;
  insert into public.payments(transaction_id, method, amount_received, change_amount, status)
  values (v_new, p_payment_method, v_total, 0, 'paid');
  perform public._066_recount_shift(t.shift_id);

  insert into public.transaction_edits(transaction_id, edited_by, kind, reason, before, after)
  values (t.id, auth.uid(), 'correction', v_reason, v_before, public._067_snapshot(v_new));
  return jsonb_build_object('id', v_new, 'number', v_number, 'total', v_total, 'previousTotal', t.total, 'previousNumber', t.number);
end $$;
revoke all on function public.owner_correct_bill(uuid, jsonb, public.payment_method, text, text, text) from public, anon;
grant execute on function public.owner_correct_bill(uuid, jsonb, public.payment_method, text, text, text) to authenticated;

-- Same as 067 plus the bill this one corrects and the bill that corrected it.
create or replace function public.owner_list_bills(p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_status text default 'completed',
  p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
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
        'voidReason', r.void_reason, 'discount', r.discount, 'refundedTotal', r.refunded_total,
        'editCount', (select count(*) from public.transaction_edits e where e.transaction_id = r.id),
        'correctsNumber', (select c.number from public.transactions c where c.id = r.corrects_transaction_id),
        'correctedByNumber', (select c.number from public.transactions c where c.corrects_transaction_id = r.id order by c.created_at desc limit 1)
      ) order by r.created_at desc, r.id)
      from (
        select f.id, f.number, f.status, f.total, f.payment_method, f.created_at, f.customer_name, f.table_number,
               f.outlet_id, o.name as outlet_name, coalesce(cs.cashier_name, 'Kasir dihapus') as cashier_name,
               f.void_reason, f.item_discount + f.bill_discount as discount, f.refunded_total, f.corrects_transaction_id
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

-- ---------------------------------------------------------------- 2) cash in and out of a drawer
create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id),
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14,2) not null check (amount > 0 and amount = round(amount) and amount <= 1000000000),
  reason text not null check (char_length(reason) between 3 and 200),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_shift on public.cash_movements(shift_id);
alter table public.cash_movements enable row level security;
revoke all on public.cash_movements from public, anon, authenticated;

-- The 071 cash lines are cash movements; their cash book rows keep their ids.
insert into public.cash_movements(id, shift_id, outlet_id, direction, amount, reason, created_by, created_at)
select a.id, a.shift_id, a.outlet_id, case when a.amount > 0 then 'in' else 'out' end, abs(a.amount), a.reason, a.created_by, a.created_at
from public.shift_adjustments a where a.kind = 'cash'
on conflict (id) do nothing;
update public.cash_ledger set source_type = 'cash_movement'
where source_type = 'adjustment' and source_id in (select id from public.shift_adjustments where kind = 'cash');
delete from public.shift_adjustments where kind = 'cash';
drop function if exists public.owner_add_shift_adjustment(uuid, text, numeric, text, text);
drop function if exists public.owner_list_shift_balances(uuid, timestamptz, timestamptz, integer);

create or replace function public.owner_add_cash_movement(p_shift_id uuid, p_direction text, p_amount numeric, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  s public.shifts%rowtype;
  m public.cash_movements%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_direction is null or p_direction not in ('in', 'out') then raise exception 'Pilih uang masuk atau uang keluar'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount) or p_amount > 1000000000 then
    raise exception 'Nominal harus angka bulat lebih dari 0, maksimal Rp1.000.000.000';
  end if;
  if char_length(v_reason) < 3 then raise exception 'Alasan wajib diisi, minimal 3 karakter'; end if;
  if char_length(v_reason) > 200 then raise exception 'Alasan maksimal 200 karakter'; end if;
  select * into s from public.shifts where id = p_shift_id;
  if not found or not public.is_owner_of_outlet(s.outlet_id) then raise exception 'Shift tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mencatat uang laci'); end if;
  select * into s from public.shifts where id = p_shift_id for update;

  insert into public.cash_movements(shift_id, outlet_id, direction, amount, reason, created_by)
  values (s.id, s.outlet_id, p_direction, p_amount, v_reason, auth.uid())
  returning * into m;
  insert into public.cash_ledger(shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id)
  values (s.id, s.cashier_id, s.outlet_id, p_direction::public.cash_ledger_direction, p_amount,
    case p_direction when 'in' then 'Uang masuk: ' else 'Uang keluar: ' end || v_reason, 'cash_movement', m.id);
  perform public._066_recount_shift(s.id);
  return jsonb_build_object('id', m.id, 'direction', m.direction, 'amount', m.amount, 'reason', m.reason, 'createdAt', m.created_at);
end $$;
revoke all on function public.owner_add_cash_movement(uuid, text, numeric, text) from public, anon;
grant execute on function public.owner_add_cash_movement(uuid, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------- 3) expenses: cancel and add
create table if not exists public.expense_item_cancellations (
  id uuid primary key,
  expense_id uuid not null references public.expenses(id) on delete cascade,
  position smallint not null,
  name text not null,
  category text not null,
  quantity numeric not null,
  unit text not null,
  amount numeric not null,
  paid_from text not null,
  reason text not null check (char_length(reason) between 3 and 200),
  cancelled_by uuid,
  cancelled_at timestamptz not null default now(),
  -- Set when the item's day was locked (stage 4): the cancellation is then booked on its own date.
  posted_at timestamptz
);
create index if not exists expense_item_cancellations_expense on public.expense_item_cancellations(expense_id);
-- A shift whose items were all cancelled keeps its record with a total of 0.
alter table public.expenses drop constraint if exists expenses_total_check;
alter table public.expenses add constraint expenses_total_check check (total >= 0);
alter table public.expense_item_cancellations enable row level security;
revoke all on public.expense_item_cancellations from public, anon, authenticated;

-- The expense's total and its cash book row follow its items; a closed shift's expected cash follows the cash book.
create or replace function public._073_sync_expense(p_expense_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare e public.expenses%rowtype; v_drawer numeric;
begin
  select * into e from public.expenses where id = p_expense_id;
  update public.expenses set total = (select coalesce(sum(amount), 0) from public.expense_items where expense_id = e.id) where id = e.id;
  select coalesce(sum(amount), 0) into v_drawer from public.expense_items where expense_id = e.id and paid_from = 'drawer';
  if v_drawer > 0 then
    insert into public.cash_ledger(shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id)
    values (e.shift_id, e.cashier_id, e.outlet_id, 'out', v_drawer, 'Pengeluaran', 'expense', e.id)
    on conflict (source_type, source_id) where source_id is not null do update set amount = excluded.amount;
  else
    delete from public.cash_ledger where source_type = 'expense' and source_id = e.id;
  end if;
  perform public._066_recount_shift(e.shift_id);
end $$;
revoke all on function public._073_sync_expense(uuid) from public, anon, authenticated;

create or replace function public.owner_cancel_expense_item(p_item_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  i public.expense_items%rowtype;
  e public.expenses%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 3 then raise exception 'Alasan wajib diisi, minimal 3 karakter'; end if;
  if char_length(v_reason) > 200 then raise exception 'Alasan maksimal 200 karakter'; end if;
  select * into i from public.expense_items where id = p_item_id;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dibatalkan'; end if;
  select * into e from public.expenses where id = i.expense_id and business_id = b;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dibatalkan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('membatalkan pengeluaran'); end if;
  perform 1 from public.shifts where id = e.shift_id for update;
  select * into i from public.expense_items where id = p_item_id for update;
  if not found then raise exception 'Barang tidak ditemukan atau sudah dibatalkan'; end if;

  insert into public.expense_item_cancellations(id, expense_id, position, name, category, quantity, unit, amount, paid_from, reason, cancelled_by)
  values (i.id, i.expense_id, i.position, i.name, i.category, i.quantity, i.unit, i.amount, i.paid_from, v_reason, auth.uid());
  delete from public.expense_items where id = i.id;
  perform public._073_sync_expense(e.id);
  return public.expense_json(e.id);
end $$;

-- Items the owner adds to a shift's expenses (open or closed). Same checks as the POS (expense_items_checked).
create or replace function public.owner_add_expense_items(p_shift_id uuid, p_paid_from text, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  s public.shifts%rowtype;
  e public.expenses%rowtype;
  v_items jsonb;
  v_count int := 0;
begin
  select * into s from public.shifts where id = p_shift_id;
  if not found or not public.is_owner_of_outlet(s.outlet_id) then raise exception 'Shift tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mencatat pengeluaran'); end if;
  if coalesce(p_paid_from, '') not in ('drawer', 'other') then raise exception 'Pilih sumber uang: kas laci atau bukan dari laci.'; end if;
  v_items := public.expense_items_checked(p_items, p_paid_from);
  if jsonb_array_length(v_items) > 30 then raise exception 'Maksimal 30 barang dalam satu catatan.'; end if;
  select * into s from public.shifts where id = p_shift_id for update;

  select * into e from public.expenses where shift_id = s.id;
  if e.id is null then
    insert into public.expenses(business_id, outlet_id, shift_id, cashier_id, total, entry_keys)
    values (b, s.outlet_id, s.id, s.cashier_id, 0, '{}')
    returning * into e;
  end if;
  select count(*) into v_count from public.expense_items where expense_id = e.id;
  if v_count + jsonb_array_length(v_items) > 200 then raise exception 'Pengeluaran shift ini sudah mencapai 200 barang.'; end if;
  insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount, paid_from)
  select e.id, (v_count + x.ord - 1)::smallint, x.v->>'name', x.v->>'category', (x.v->>'quantity')::numeric, x.v->>'unit',
    (x.v->>'amount')::numeric, p_paid_from
  from jsonb_array_elements(v_items) with ordinality as x(v, ord);
  perform public._073_sync_expense(e.id);
  return public.expense_json(e.id);
end $$;
revoke all on function public.owner_cancel_expense_item(uuid, text) from public, anon;
revoke all on function public.owner_add_expense_items(uuid, text, jsonb) from public, anon;
grant execute on function public.owner_cancel_expense_item(uuid, text) to authenticated;
grant execute on function public.owner_add_expense_items(uuid, text, jsonb) to authenticated;

-- Same as 043 plus the cancelled items (with the reason) and each item's id.
create or replace function public.expense_json(p_expense_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
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
    ), '[]'::jsonb),
    'cancelled', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'category', c.category, 'quantity', c.quantity,
        'unit', c.unit, 'amount', c.amount, 'paidFrom', c.paid_from, 'reason', c.reason, 'cancelledAt', c.cancelled_at) order by c.position)
      from public.expense_item_cancellations c where c.expense_id = e.id
    ), '[]'::jsonb))
  from public.expenses e join public.outlets o on o.id = e.outlet_id join public.shifts s on s.id = e.shift_id
  where e.id = p_expense_id
$$;

-- ---------------------------------------------------------------- the ledger with cash movements
-- Same as 072 plus cash movements; the adjustment lines are now only the old (071) sales and expense corrections.
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
  ('cash_outside', coalesce(s.closing_cash, 0))
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
) as x(account, amount);
revoke all on public.ledger from public, anon, authenticated;

-- ---------------------------------------------------------------- 5) checks per outlet
drop function if exists public.owner_ledger_checks(timestamptz, timestamptz);
drop function if exists public.ledger_checks(uuid, timestamptz, timestamptz);
create or replace function public.ledger_checks(p_business uuid, p_outlet uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer set search_path = public as $$
  with l as (select * from public.ledger where business_id = p_business and (p_outlet is null or outlet_id = p_outlet) and at >= p_from and at < p_to),
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
    where o.business_id = p_business and (p_outlet is null or o.id = p_outlet) and t.status = 'completed' and t.created_at >= p_from and t.created_at < p_to
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
    where o.business_id = p_business and (p_outlet is null or o.id = p_outlet) and s.opened_at >= p_from and s.opened_at < p_to
      and ((s.status = 'closed' and (d.drawer <> 0 or s.expected_cash <> c.book or s.variance <> s.closing_cash - s.expected_cash))
        or (s.status = 'open' and d.drawer <> c.book))
  )
  select coalesce(jsonb_agg(jsonb_build_object('rule', rule, 'ref', ref, 'detail', detail) order by rule, ref), '[]'::jsonb) from fails
$$;
revoke all on function public.ledger_checks(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4) the Tutup hari page
-- One outlet, one business date: every shift's cash and QRIS from the ledger, its cash movements, the old corrections,
-- and the checks for the day. Money only from the database.
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
  -- The day's documents: from the first shift's opening to now (a shift can run past midnight).
  select coalesce(min(opened_at), (p_date::timestamp at time zone v_tz)) into v_from from public.shifts where outlet_id = p_outlet_id and business_date = p_date;
  v_to := greatest(now(), ((p_date + 1)::timestamp at time zone v_tz)) + interval '1 second';

  return jsonb_build_object(
    'date', p_date,
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
    'checks', public.ledger_checks(b, p_outlet_id, v_from, v_to)
  );
end $$;
revoke all on function public.owner_day_close(uuid, date) from public, anon;
grant execute on function public.owner_day_close(uuid, date) to authenticated;
