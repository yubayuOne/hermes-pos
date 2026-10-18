-- 033: refund item untuk bill yang sudah dibayar.
-- * Bill asli tidak diubah. Refund disimpan di transaction_refunds + transaction_refund_items dan menempel ke bill.
-- * Refund dicatat di shift aktif kasir yang melakukan refund (bisa beda dengan shift bill), maksimal 24 jam setelah bill dibuat.
-- * Nilai dihitung server: bagian net item (setelah diskon item) dikali porsi diskon bill. Refund yang menghabiskan bill
--   memakai sisa persis (total - refunded_total), jadi jumlah semua refund selalu sama dengan total bill.
-- * Refund tunai menulis cash_ledger 'out' di shift aktif. Refund QRIS/transfer hanya dicatat.
-- * Kode persetujuan sama dengan void. Bill yang sudah direfund tidak bisa di-void (kas bisa terpotong dua kali).

-- ---------------------------------------------------------------- 1. tabel
alter table public.transactions add column if not exists refunded_total numeric(14,2) not null default 0;

create table if not exists public.transaction_refunds (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id),
  shift_id uuid not null references public.shifts(id),
  cashier_id uuid not null,
  outlet_id uuid not null references public.outlets(id),
  method public.payment_method not null check (method in ('cash','qris')),
  amount numeric(14,2) not null check (amount >= 0),
  reason text not null check (char_length(reason) between 3 and 200),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (cashier_id, idempotency_key)
);
create index if not exists transaction_refunds_transaction on public.transaction_refunds(transaction_id);
create index if not exists transaction_refunds_shift on public.transaction_refunds(shift_id);
create index if not exists transaction_refunds_outlet_created on public.transaction_refunds(outlet_id, created_at);

create table if not exists public.transaction_refund_items (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.transaction_refunds(id) on delete cascade,
  transaction_item_id uuid not null references public.transaction_items(id),
  quantity numeric(14,3) not null check (quantity > 0),
  amount numeric(14,2) not null check (amount >= 0),
  hpp_amount numeric(14,2) not null check (hpp_amount >= 0),
  restock boolean not null default false
);
create index if not exists transaction_refund_items_refund on public.transaction_refund_items(refund_id);
create index if not exists transaction_refund_items_item on public.transaction_refund_items(transaction_item_id);

-- Klien hanya membaca lewat RPC.
alter table public.transaction_refunds enable row level security;
alter table public.transaction_refund_items enable row level security;
revoke all on public.transaction_refunds from anon, authenticated;
revoke all on public.transaction_refund_items from anon, authenticated;

-- ---------------------------------------------------------------- 2. kode persetujuan bersama (void + refund)
-- null = kode benar. Selain itu hasil gagal untuk dikembalikan apa adanya (tidak raise, supaya hitungan salah tersimpan).
create or replace function public.check_void_code(p_business_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  vc public.business_void_codes%rowtype;
  v_failed integer;
begin
  select * into vc from public.business_void_codes where business_id = p_business_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_code'); end if;
  if vc.locked_until is not null and vc.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', vc.locked_until);
  end if;
  if coalesce(p_code, '') !~ '^[0-9]{6}$' or vc.code_hash <> crypt(p_code, vc.code_hash) then
    v_failed := vc.failed + 1;
    if v_failed >= 5 then
      update public.business_void_codes set failed = 0, locked_until = now() + interval '5 minutes' where business_id = p_business_id;
      return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', now() + interval '5 minutes');
    end if;
    update public.business_void_codes set failed = v_failed where business_id = p_business_id;
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'attempts_left', 5 - v_failed);
  end if;
  update public.business_void_codes set failed = 0, locked_until = null where business_id = p_business_id;
  return null;
end $$;
revoke execute on function public.check_void_code(uuid, text) from public, anon, authenticated;

create or replace function public.void_transaction_approved(p_transaction_id uuid, p_reason text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.transactions%rowtype;
  b uuid;
  v_fail jsonb;
begin
  select * into t from public.transactions where id = p_transaction_id;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id, t.outlet_id);
  b := public.business_of_outlet(t.outlet_id);
  if not public.subscription_active(b) then perform public.raise_expired('membatalkan bill'); end if;
  v_fail := public.check_void_code(b, p_code);
  if v_fail is not null then return v_fail; end if;
  return jsonb_build_object('ok', true) || public.void_transaction(p_transaction_id, p_reason);
end $$;
grant execute on function public.void_transaction_approved(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 3. void menolak bill yang sudah direfund
-- Sama dengan 029, ditambah cek refunded_total.
create or replace function public.void_transaction(p_transaction_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.transactions%rowtype;
  v_shift_status public.shift_status;
  v_reason text := btrim(coalesce(p_reason,''));
begin
  select * into t from public.transactions where id=p_transaction_id for update;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id,t.outlet_id);

  if t.status = 'voided' then
    return jsonb_build_object('number',t.number,'total',t.total,'paymentMethod',t.payment_method,'alreadyVoided',true);
  end if;
  if t.status <> 'completed' then raise exception 'Hanya bill yang sudah dibayar yang dapat dibatalkan'; end if;
  if t.parent_transaction_id is not null then
    raise exception 'Bill hasil Split Bill tidak dapat dibatalkan satu per satu';
  end if;
  if t.refunded_total > 0 then
    raise exception 'Bill ini sudah direfund sebagian. Refund sisa item, bukan batalkan bill.' using errcode = 'P0001', hint = 'already_refunded';
  end if;
  if char_length(v_reason) < 3 then raise exception 'Alasan pembatalan wajib diisi'; end if;

  select s.status into v_shift_status from public.shifts s where s.id=t.shift_id for update;
  if v_shift_status is distinct from 'open' then
    raise exception 'Shift bill ini sudah ditutup, bill tidak dapat dibatalkan';
  end if;

  update public.products p
  set stock = p.stock + x.qty
  from (
    select ti.product_id, sum(ti.quantity) as qty
    from public.transaction_items ti
    where ti.transaction_id=t.id
    group by ti.product_id
  ) x
  where p.id = x.product_id and p.track_stock;

  update public.payments set status='refunded' where transaction_id=t.id;

  update public.transactions
  set status='voided', voided_at=now(), void_reason=v_reason
  where id=t.id;

  return jsonb_build_object('number',t.number,'total',t.total,'paymentMethod',t.payment_method,'alreadyVoided',false);
end $$;

-- ---------------------------------------------------------------- 4. refund
-- p_items: [{ "item_id": uuid (transaction_items.id), "quantity": n, "restock": bool }]
-- Urutan kunci sama dengan void (bill dulu, lalu shift), supaya tidak saling menunggu.
create or replace function public.refund_items_approved(
  p_transaction_id uuid,
  p_shift_id uuid,
  p_cashier_id uuid,
  p_items jsonb,
  p_method public.payment_method,
  p_reason text,
  p_code text,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.transactions%rowtype;
  r public.transaction_refunds%rowtype;
  b uuid;
  v_fail jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_net_sum numeric;
  v_amount numeric := 0;
  v_left numeric;
  v_full boolean;
  v_req jsonb;
  it record;
begin
  select * into t from public.transactions where id = p_transaction_id;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(p_cashier_id, t.outlet_id);
  if v_key = '' then raise exception 'Kunci idempotensi wajib diisi'; end if;

  select * into t from public.transactions where id = p_transaction_id for update;
  perform public.assert_open_shift(p_shift_id, p_cashier_id, t.outlet_id);

  -- Kirim ulang (tombol ditekan dua kali, koneksi putus): kembalikan refund yang sama.
  select * into r from public.transaction_refunds where cashier_id = p_cashier_id and idempotency_key = v_key;
  if found then
    if r.transaction_id <> t.id then raise exception 'Kunci idempotensi sudah dipakai untuk bill lain'; end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'refundId', r.id, 'number', t.number, 'amount', r.amount,
      'method', r.method, 'refundedTotal', t.refunded_total, 'fullyRefunded', t.refunded_total >= t.total);
  end if;

  b := public.business_of_outlet(t.outlet_id);
  if not public.subscription_active(b) then perform public.raise_expired('refund'); end if;
  if t.status <> 'completed' then raise exception 'Hanya bill yang sudah dibayar yang dapat direfund'; end if;
  if t.created_at < now() - interval '24 hours' then
    raise exception 'Refund hanya bisa dalam 24 jam setelah bill dibuat.' using errcode = 'P0001', hint = 'refund_window';
  end if;
  if p_method not in ('cash','qris') then raise exception 'Metode refund tidak valid'; end if;
  if char_length(v_reason) < 3 then raise exception 'Alasan refund wajib diisi'; end if;
  if char_length(v_reason) > 200 then raise exception 'Alasan refund terlalu panjang'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Pilih item yang direfund'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Pilih item yang direfund'; end if;

  -- Baris yang diminta, digabung per item, dengan sisa yang belum direfund. Disimpan sebagai jsonb, bukan temp table:
  -- temp table milik sesi pemanggil bisa membawa trigger yang ikut jalan dengan hak security definer.
  select jsonb_agg(to_jsonb(z)) into v_req from (
    select q.item_id, q.qty, q.restock, ti.net_subtotal, ti.quantity, ti.hpp_unit, ti.product_id,
           ti.quantity - coalesce((select sum(ri.quantity) from public.transaction_refund_items ri where ri.transaction_item_id = ti.id), 0) as left_qty
    from (
      select (x->>'item_id')::uuid as item_id, sum((x->>'quantity')::numeric) as qty, bool_or(coalesce((x->>'restock')::boolean, false)) as restock
      from jsonb_array_elements(p_items) x group by 1
    ) q
    left join public.transaction_items ti on ti.id = q.item_id and ti.transaction_id = t.id
  ) z;

  if exists (select 1 from jsonb_to_recordset(v_req) q(item_id uuid, product_id uuid) where q.item_id is null or q.product_id is null) then
    raise exception 'Item tidak ada di bill ini';
  end if;
  if exists (select 1 from jsonb_to_recordset(v_req) q(qty numeric) where q.qty is null or q.qty <= 0) then raise exception 'Jumlah refund tidak valid'; end if;
  if exists (select 1 from jsonb_to_recordset(v_req) q(qty numeric, left_qty numeric) where q.qty > q.left_qty) then
    raise exception 'Jumlah refund melebihi sisa item yang belum direfund.' using errcode = 'P0001', hint = 'refund_exceeds';
  end if;

  -- Semua input valid, baru kode dicek supaya salah ketik item tidak memakan jatah percobaan.
  v_fail := public.check_void_code(b, p_code);
  if v_fail is not null then return v_fail; end if;

  select sum(net_subtotal) into v_net_sum from public.transaction_items where transaction_id = t.id;
  v_left := t.total - t.refunded_total;
  v_full := not exists (
    select 1 from public.transaction_items ti
    where ti.transaction_id = t.id
      and ti.quantity - coalesce((select sum(ri.quantity) from public.transaction_refund_items ri where ri.transaction_item_id = ti.id), 0)
          - coalesce((select q.qty from jsonb_to_recordset(v_req) q(item_id uuid, qty numeric) where q.item_id = ti.id), 0) > 0
  );

  insert into public.transaction_refunds(transaction_id, shift_id, cashier_id, outlet_id, method, amount, reason, idempotency_key)
  values (t.id, p_shift_id, p_cashier_id, t.outlet_id, p_method, 0, v_reason, v_key)
  returning * into r;

  for it in
    select * from jsonb_to_recordset(v_req) q(item_id uuid, qty numeric, restock boolean, net_subtotal numeric, quantity numeric, hpp_unit numeric)
    order by q.item_id
  loop
    insert into public.transaction_refund_items(refund_id, transaction_item_id, quantity, amount, hpp_amount, restock)
    values (r.id, it.item_id, it.qty,
      case when v_net_sum > 0 then round(it.net_subtotal * it.qty / it.quantity * t.total / v_net_sum) else 0 end,
      round(it.hpp_unit * it.qty, 2), it.restock);
  end loop;

  select sum(amount) into v_amount from public.transaction_refund_items where refund_id = r.id;
  -- Refund terakhir menghabiskan sisa persis; refund sebagian tidak boleh melewati sisa karena pembulatan.
  if v_full or v_amount > v_left then
    update public.transaction_refund_items set amount = amount + (v_left - v_amount)
    where id = (select id from public.transaction_refund_items where refund_id = r.id order by amount desc, id limit 1);
    v_amount := v_left;
  end if;
  update public.transaction_refunds set amount = v_amount where id = r.id;

  update public.products p set stock = p.stock + x.qty
  from (select q.product_id, sum(q.qty) as qty from jsonb_to_recordset(v_req) q(product_id uuid, qty numeric, restock boolean) where q.restock group by 1) x
  where p.id = x.product_id and p.track_stock;

  update public.transactions set refunded_total = refunded_total + v_amount where id = t.id;

  if p_method = 'cash' and v_amount > 0 then
    insert into public.cash_ledger(shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id)
    values (p_shift_id, p_cashier_id, t.outlet_id, 'out', v_amount, 'Refund ' || t.number, 'refund', r.id);
  end if;

  insert into public.notifications(business_id, kind, params, dedupe_key)
  values (b, 'refund', jsonb_build_object('number', t.number, 'amount', v_amount, 'method', p_method, 'reason', v_reason,
    'cashier', (select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = p_cashier_id limit 1)), 'refund:' || r.id)
  on conflict (business_id, dedupe_key) do nothing;

  return jsonb_build_object('ok', true, 'replayed', false, 'refundId', r.id, 'number', t.number, 'amount', v_amount,
    'method', p_method, 'refundedTotal', t.refunded_total + v_amount, 'fullyRefunded', v_full);
end $$;
revoke execute on function public.refund_items_approved(uuid,uuid,uuid,jsonb,public.payment_method,text,text,text) from public, anon;
grant execute on function public.refund_items_approved(uuid,uuid,uuid,jsonb,public.payment_method,text,text,text) to authenticated;

-- ---------------------------------------------------------------- 5. laporan shift: omset dikurangi refund di shift ini
-- Rincian kategori/produk tetap penjualan; refund ditampilkan sebagai angka sendiri.
create or replace function public.get_shift_report(p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
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
           sum(ti.quantity) as qty, sum(ti.net_subtotal) as total
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
end $$;

-- ---------------------------------------------------------------- 6. dashboard: penjualan dikurangi refund pada rentang yang sama
-- Refund dihitung pada kasir dan jam refund dilakukan. Grafik per jam dan menu terlaris tetap penjualan.
create or replace function public.get_dashboard_summary(
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_prev_from timestamptz,
  p_prev_to timestamptz
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  result jsonb;
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
    select extract(hour from created_at at time zone 'Asia/Jakarta')::int as hour, sum(total) as total
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
end $$;

-- ---------------------------------------------------------------- 7. daftar bill + refundedTotal
create or replace function public.list_shift_bills(
  p_shift_id uuid,
  p_status text,
  p_search text default '',
  p_limit int default 30,
  p_offset int default 0
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  s public.shifts%rowtype;
  q text := '%' || lower(btrim(coalesce(p_search,''))) || '%';
  lim int := least(greatest(coalesce(p_limit,30),1),100);
  off int := greatest(coalesce(p_offset,0),0);
  rows jsonb;
  cnt_completed int;
  cnt_held int;
  cnt_voided int;
begin
  if p_status not in ('completed','held','voided') then raise exception 'Status bill tidak valid'; end if;
  select * into s from public.shifts where id=p_shift_id;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(s.cashier_id,s.outlet_id);

  select count(*) filter (where status::text='completed'),
         count(*) filter (where status::text='held'),
         count(*) filter (where status::text='voided')
    into cnt_completed, cnt_held, cnt_voided
  from public.transactions where shift_id=p_shift_id and status::text in ('completed','held','voided');

  with page as (
    select t.*
    from public.transactions t
    where t.shift_id=p_shift_id and t.status::text=p_status
      and (q='%%' or lower(t.number||' '||t.customer_name||' '||t.table_number) like q)
    order by t.created_at desc, t.id
    limit lim offset off
  ),
  parent as (
    select ti.transaction_id, ti.product_id, sum(ti.quantity) as qty,
           max(ti.selling_price_unit) as price, sum(ti.discount_amount) as disc
    from public.transaction_items ti join page p on p.id=ti.transaction_id
    group by 1,2
  ),
  allocated as (
    select c.parent_transaction_id as transaction_id, ci.product_id,
           sum(ci.quantity) as qty, sum(ci.discount_amount) as disc
    from public.transactions c
    join public.transaction_items ci on ci.transaction_id=c.id
    where c.parent_transaction_id in (select id from page) and c.status='completed'
    group by 1,2
  ),
  remaining as (
    select p.transaction_id,
           greatest(p.qty - coalesce(a.qty,0),0) as qty,
           greatest(p.qty - coalesce(a.qty,0),0) * p.price - (p.disc - coalesce(a.disc,0)) as amount,
           coalesce(a.qty,0) > 0 as has_alloc
    from parent p
    left join allocated a on a.transaction_id=p.transaction_id and a.product_id=p.product_id
  ),
  agg as (
    select transaction_id, sum(qty) as qty, sum(amount) as amount, bool_or(has_alloc) as has_alloc
    from remaining group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',            p.id,
    'number',        p.number,
    'customerName',  p.customer_name,
    'customerPhone', p.customer_phone,
    'table',         p.table_number,
    'status',        p.status,
    'total',         case when p.status::text='held' and coalesce(a.has_alloc,false) then coalesce(a.amount,0) else p.total end,
    'subtotal',      p.subtotal,
    'itemDiscount',  p.item_discount,
    'billDiscount',  p.bill_discount,
    'refundedTotal', p.refunded_total,
    'voidReason',    p.void_reason,
    'voidedAt',      p.voided_at,
    'paymentMethod', p.payment_method,
    'createdAt',     p.created_at,
    'itemCount',     case when p.status::text='held' then coalesce(a.qty,0)
                          else coalesce((select sum(ti.quantity) from public.transaction_items ti where ti.transaction_id=p.id),0) end
  ) order by p.created_at desc, p.id),'[]'::jsonb)
  into rows
  from page p left join agg a on a.transaction_id=p.id;

  return jsonb_build_object('rows',rows,'completedCount',cnt_completed,'heldCount',cnt_held,'voidedCount',cnt_voided);
end $$;

-- ---------------------------------------------------------------- 8. item bill + itemId, refundedQty, trackStock
create or replace function public.get_bill_items(p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  t public.transactions%rowtype;
begin
  select * into t from public.transactions where id=p_transaction_id;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id,t.outlet_id);

  if t.status::text='held' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId',x->>'productId','productName',x->>'name','station',x->>'station',
        'quantity',(x->>'quantity')::numeric,'unitPrice',(x->>'unitPrice')::numeric,
        'subtotal',(x->>'quantity')::numeric*(x->>'unitPrice')::numeric,
        'discount',coalesce((x->>'discountAmount')::numeric,0),
        'note',x->>'note'))
      from jsonb_array_elements(public.get_held_bill_items(p_transaction_id)) x
    ),'[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'itemId',ti.id,
      'productId',ti.product_id,'productName',pr.name,'station',pr.station,
      'quantity',ti.quantity,'unitPrice',ti.selling_price_unit,'subtotal',ti.subtotal,
      'discount',ti.discount_amount,'note',ti.note,'trackStock',pr.track_stock,
      'refundedQty',coalesce((select sum(ri.quantity) from public.transaction_refund_items ri where ri.transaction_item_id=ti.id),0)
    ) order by pr.name, ti.id)
    from public.transaction_items ti join public.products pr on pr.id=ti.product_id
    where ti.transaction_id=p_transaction_id
  ),'[]'::jsonb);
end $$;
