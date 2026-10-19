-- Bookkeeping, stage 3 (docs/ACCOUNTING.md sections 4.5 and 5.3): stock changes only through documents.
--
-- Every change to a tracked product's stock is now one of: a sale, a void, a refund put back in stock, or a stock
-- document (stock in, adjustment, count). The product form can no longer overwrite stock. A count (opname) records what
-- is on the shelf and books the difference. Check P7: for every tracked product, the last count (or opening balance)
-- plus every movement after it equals the stock the POS sells from.
--
-- Kinds: opening (this migration's starting balance), initial (a product starts being tracked), tracking_off,
-- stock_in, adjustment (damaged, lost, used: signed), opname (count). Each line holds the change (qty) and, for
-- opening, initial, and opname, the absolute count (counted) and the stock before (book_qty).

create table if not exists public.stock_documents (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  kind text not null check (kind in ('opening', 'initial', 'tracking_off', 'stock_in', 'adjustment', 'opname')),
  reason text not null default '' check (char_length(reason) <= 200),
  created_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.stock_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.stock_documents(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  qty numeric not null,
  counted numeric,
  book_qty numeric,
  hpp_unit numeric not null default 0
);
create index if not exists stock_documents_outlet_at on public.stock_documents(outlet_id, created_at);
create index if not exists stock_document_lines_product on public.stock_document_lines(product_id);
create index if not exists stock_document_lines_document on public.stock_document_lines(document_id);
alter table public.stock_documents enable row level security;
alter table public.stock_document_lines enable row level security;
revoke all on public.stock_documents from public, anon, authenticated;
revoke all on public.stock_document_lines from public, anon, authenticated;

-- Opening balance: every tracked product, as it is now, per outlet.
do $$
declare o record; d uuid;
begin
  for o in select distinct outlet_id from public.products where track_stock and not is_temporary loop
    insert into public.stock_documents(outlet_id, kind, reason) values (o.outlet_id, 'opening', 'Saldo awal pembukuan stok') returning id into d;
    insert into public.stock_document_lines(document_id, product_id, qty, counted, book_qty, hpp_unit)
    select d, p.id, p.stock, p.stock, 0, p.hpp from public.products p where p.outlet_id = o.outlet_id and p.track_stock and not p.is_temporary;
  end loop;
end $$;

-- A product that starts (or stops) being tracked gets a document, so its stock has a starting point.
create or replace function public.trg_product_stock_tracking()
returns trigger
language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  if new.is_temporary then return new; end if;
  if new.track_stock and (tg_op = 'INSERT' or not old.track_stock) then
    insert into public.stock_documents(outlet_id, kind, reason, created_by) values (new.outlet_id, 'initial', 'Stok mulai dilacak', auth.uid()) returning id into d;
    insert into public.stock_document_lines(document_id, product_id, qty, counted, book_qty, hpp_unit) values (d, new.id, new.stock, new.stock, 0, new.hpp);
  elsif tg_op = 'UPDATE' and old.track_stock and not new.track_stock then
    insert into public.stock_documents(outlet_id, kind, reason, created_by) values (new.outlet_id, 'tracking_off', 'Stok tidak dilacak lagi', auth.uid()) returning id into d;
    insert into public.stock_document_lines(document_id, product_id, qty, counted, book_qty, hpp_unit) values (d, new.id, -old.stock, 0, old.stock, new.hpp);
  end if;
  return new;
end $$;
revoke all on function public.trg_product_stock_tracking() from public, anon, authenticated;
drop trigger if exists product_stock_tracking on public.products;
create trigger product_stock_tracking
  after insert or update of track_stock on public.products
  for each row execute function public.trg_product_stock_tracking();

-- Same as 003 except the stock: a tracked product keeps its stock (p_stock is ignored; it changes only by stock documents,
-- menu Stok). p_stock is the starting stock when tracking starts; stock is cleared when it stops.
create or replace function public.update_product(p_product_id uuid, p_outlet_id uuid, p_category_id uuid, p_name text, p_hpp numeric,
  p_selling_price numeric, p_stock numeric, p_station public.product_station, p_track_stock boolean default true)
returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; cur public.products%rowtype;
begin
  perform public.assert_catalog_access(p_outlet_id);
  if nullif(trim(p_name), '') is null then raise exception 'Nama produk wajib diisi'; end if;
  if p_hpp < 0 or p_selling_price < 0 or p_stock < 0 then raise exception 'HPP, harga jual, dan stok tidak boleh negatif'; end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories where id = p_category_id and outlet_id = p_outlet_id and is_active = true
  ) then
    raise exception 'Kategori tidak ditemukan';
  end if;
  select * into cur from public.products where id = p_product_id and outlet_id = p_outlet_id and is_active = true for update;
  if not found then raise exception 'Produk tidak ditemukan'; end if;

  update public.products
  set category_id = p_category_id, name = trim(p_name), hpp = p_hpp, selling_price = p_selling_price,
      stock = case when not p_track_stock then 0 when cur.track_stock then cur.stock else p_stock end,
      track_stock = p_track_stock, station = p_station
  where id = p_product_id
  returning id into pid;
  return pid;
end $$;

-- ---------------------------------------------------------------- the owner's stock documents
-- p_lines: [{"productId", "qty"}]. stock_in: qty > 0 received. adjustment: qty signed (- damaged, lost, used; + found).
-- opname: qty = the count on the shelf; the difference from the stock is booked. Whole or up to 3 decimals.
create or replace function public.owner_stock_document(p_outlet_id uuid, p_kind text, p_reason text, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_reason text := btrim(coalesce(p_reason, ''));
  d public.stock_documents%rowtype;
  x record;
  p public.products%rowtype;
  v_delta numeric;
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_kind is null or p_kind not in ('stock_in', 'adjustment', 'opname') then raise exception 'Jenis dokumen stok tidak valid'; end if;
  if char_length(v_reason) > 200 then raise exception 'Keterangan maksimal 200 karakter'; end if;
  if p_kind = 'adjustment' and char_length(v_reason) < 3 then raise exception 'Alasan penyesuaian wajib diisi, minimal 3 karakter'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mengubah stok'); end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Isi minimal satu produk'; end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'Maksimal 500 produk dalam satu dokumen'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
             where jsonb_typeof(e) <> 'object'
               or coalesce(e->>'productId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               or coalesce(e->>'qty', '') !~ '^-?[0-9]{1,6}(\.[0-9]{1,3})?$') then
    raise exception 'Data produk tidak valid';
  end if;
  if (select count(*) <> count(distinct e->>'productId') from jsonb_array_elements(p_lines) e) then raise exception 'Satu produk hanya boleh sekali'; end if;
  if p_kind = 'stock_in' and exists (select 1 from jsonb_array_elements(p_lines) e where (e->>'qty')::numeric <= 0) then
    raise exception 'Jumlah stok masuk harus lebih dari 0';
  end if;
  if p_kind = 'adjustment' and exists (select 1 from jsonb_array_elements(p_lines) e where (e->>'qty')::numeric = 0) then
    raise exception 'Jumlah penyesuaian tidak boleh 0';
  end if;
  if p_kind = 'opname' and exists (select 1 from jsonb_array_elements(p_lines) e where (e->>'qty')::numeric < 0) then
    raise exception 'Hasil hitung tidak boleh minus';
  end if;

  insert into public.stock_documents(outlet_id, kind, reason, created_by) values (p_outlet_id, p_kind, v_reason, auth.uid()) returning * into d;
  -- Products in id order, the same lock order as checkout.
  for x in select (e->>'productId')::uuid as product_id, (e->>'qty')::numeric as qty from jsonb_array_elements(p_lines) e order by 1 loop
    select * into p from public.products where id = x.product_id and outlet_id = p_outlet_id for update;
    if not found then raise exception 'Produk tidak ditemukan di outlet ini'; end if;
    if not p.track_stock then raise exception 'Ada produk yang stoknya tidak dilacak. Aktifkan Lacak stok di data produk dulu.'; end if;
    v_delta := case when p_kind = 'opname' then x.qty - p.stock else x.qty end;
    if p.stock + v_delta < 0 then raise exception 'Stok tidak boleh minus. Periksa jumlah yang dikurangi.'; end if;
    update public.products set stock = stock + v_delta where id = p.id;
    insert into public.stock_document_lines(document_id, product_id, qty, counted, book_qty, hpp_unit)
    values (d.id, p.id, v_delta, case when p_kind = 'opname' then x.qty end, p.stock, p.hpp);
  end loop;
  return public.stock_document_json(d.id);
end $$;

create or replace function public.stock_document_json(p_document_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', d.id, 'kind', d.kind, 'reason', d.reason, 'createdAt', d.created_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('productId', l.product_id, 'productName', p.name, 'qty', l.qty, 'counted', l.counted,
        'bookQty', l.book_qty, 'value', l.qty * l.hpp_unit) order by p.name)
      from public.stock_document_lines l join public.products p on p.id = l.product_id where l.document_id = d.id), '[]'::jsonb))
  from public.stock_documents d where d.id = p_document_id
$$;
revoke all on function public.stock_document_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- stock movements and P7
-- Every change of a product's stock with the moment it happened. A sale's stock leaves when it is paid (completed_at).
create or replace view public.stock_moves as
select ti.product_id, t.outlet_id, coalesce(t.completed_at, t.created_at) as at, 'sale'::text as kind, t.id as doc_id, -ti.quantity as qty
from public.transactions t join public.transaction_items ti on ti.transaction_id = t.id join public.products p on p.id = ti.product_id
where t.status in ('completed', 'voided') and p.track_stock
union all
select ti.product_id, t.outlet_id, t.voided_at, 'void', t.id, ti.quantity
from public.transactions t join public.transaction_items ti on ti.transaction_id = t.id join public.products p on p.id = ti.product_id
where t.status = 'voided' and t.voided_at is not null and p.track_stock
union all
select ti.product_id, r.outlet_id, r.created_at, 'refund', r.id, ri.quantity
from public.transaction_refund_items ri
join public.transaction_refunds r on r.id = ri.refund_id
join public.transaction_items ti on ti.id = ri.transaction_item_id
where ri.restock
union all
select l.product_id, d.outlet_id, d.created_at, d.kind, d.id, l.qty
from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id;
revoke all on public.stock_moves from public, anon, authenticated;

-- For each tracked product of the outlet (or business): the stock the books say. The last opening, initial, or count is
-- the starting point; every move after it is added.
create or replace function public.stock_book(p_business uuid, p_outlet uuid)
returns table (product_id uuid, outlet_id uuid, name text, stock numeric, book numeric, base_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.outlet_id, p.name, p.stock, b.counted + coalesce(m.qty, 0), b.at
  from public.products p
  join public.outlets o on o.id = p.outlet_id
  cross join lateral (
    select l.counted, d.created_at as at from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id
    where l.product_id = p.id and d.kind in ('opening', 'initial', 'opname') order by d.created_at desc, d.id desc limit 1
  ) b
  left join lateral (
    select sum(qty) as qty from public.stock_moves sm where sm.product_id = p.id and sm.at > b.at
  ) m on true
  where o.business_id = p_business and (p_outlet is null or p.outlet_id = p_outlet) and p.track_stock and not p.is_temporary
$$;
revoke all on function public.stock_book(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the owner's Stok page
create or replace function public.owner_list_stock(p_outlet_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business();
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('productId', p.id, 'name', p.name, 'category', coalesce(c.name, ''), 'stock', p.stock, 'hpp', p.hpp,
      'value', p.stock * p.hpp, 'isActive', p.is_active,
      'lastCount', (select max(d.created_at) from public.stock_documents d join public.stock_document_lines l on l.document_id = d.id
                    where l.product_id = p.id and d.kind = 'opname')) order by p.name)
    from public.products p left join public.categories c on c.id = p.category_id
    where p.outlet_id = p_outlet_id and p.track_stock and not p.is_temporary
  ), '[]'::jsonb);
end $$;

-- Stock documents of the outlet, newest first, 50 a page.
create or replace function public.owner_list_stock_documents(p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_page integer default 1)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); off integer := (greatest(coalesce(p_page, 1), 1) - 1) * 50;
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_to <= p_from or p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal tidak valid'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.stock_documents where outlet_id = p_outlet_id and created_at >= p_from and created_at < p_to),
    'rows', coalesce((
      select jsonb_agg(public.stock_document_json(d.id) order by d.created_at desc, d.id)
      from (select id, created_at from public.stock_documents where outlet_id = p_outlet_id and created_at >= p_from and created_at < p_to
            order by created_at desc, id limit 50 offset off) d
    ), '[]'::jsonb));
end $$;

revoke all on function public.owner_stock_document(uuid, text, text, jsonb) from public, anon;
revoke all on function public.owner_list_stock(uuid) from public, anon;
revoke all on function public.owner_list_stock_documents(uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.owner_stock_document(uuid, text, text, jsonb) to authenticated;
grant execute on function public.owner_list_stock(uuid) to authenticated;
grant execute on function public.owner_list_stock_documents(uuid, timestamptz, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------- the ledger with stock documents
-- Same as 073 plus the value of stock documents: received goods and counts into or out of inventory.
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
) as x(account, amount)
union all
-- Stock documents: the value of the change at the product's HPP. Received goods are set against the absorbed cost (the
-- purchases are recorded as expenses); losses and count differences are a cost of their own (stock_adjustment); the
-- opening balance and tracking switches against opening_balance.
select o.business_id, d.outlet_id, null::uuid, null::uuid, d.created_at, 'stock_' || d.kind, d.id, x.account, null, l.product_id, x.qty, x.amount
from public.stock_document_lines l
join public.stock_documents d on d.id = l.document_id
join public.outlets o on o.id = d.outlet_id
cross join lateral (values
  ('inventory', l.qty, l.qty * l.hpp_unit),
  (case d.kind when 'stock_in' then 'cost_absorbed' when 'adjustment' then 'stock_adjustment' when 'opname' then 'stock_adjustment' else 'opening_balance' end,
   null::numeric, -(l.qty * l.hpp_unit))
) as x(account, qty, amount)
where l.qty * l.hpp_unit <> 0;
revoke all on public.ledger from public, anon, authenticated;

-- ---------------------------------------------------------------- checks with P7
-- Same as 073 plus P7: a tracked product whose stock differs from its stock book (the last count plus every move after).
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
    union all
    select 'P7', sb.product_id::text, jsonb_build_object('name', sb.name, 'stock', sb.stock, 'book', sb.book)
    from public.stock_book(p_business, p_outlet) sb
    where sb.stock <> sb.book
  )
  select coalesce(jsonb_agg(jsonb_build_object('rule', rule, 'ref', ref, 'detail', detail) order by rule, ref), '[]'::jsonb) from fails
$$;
