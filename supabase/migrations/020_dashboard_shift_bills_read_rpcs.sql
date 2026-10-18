-- KASBOX 020: RPC baca-saja untuk Dashboard, laporan Shift, dan daftar bill.
-- Tujuan: menghemat request & payload. Sebelumnya klien mengunduh SEMUA transaksi beserta item
-- lalu menghitung sendiri. Semua fungsi hanya membaca, memakai assert_cashier, dan hanya
-- menghitung transaksi berstatus 'completed' (kecuali daftar bill ditahan).
--   1) get_dashboard_summary : ringkasan periode + periode pembanding dalam 1 request
--   2) get_shift_report      : laporan shift (total, kategori, kas) dalam 1 request
--   3) list_shift_bills      : daftar bill ringkas berpaginasi + jumlah per tab
--   4) get_bill_items        : item satu bill, dimuat saat detail dibuka

-- ---------------------------------------------------------------------------
-- 1) Dashboard
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_summary(
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_prev_from timestamptz,
  p_prev_to timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  result jsonb;
begin
  perform public.assert_cashier(p_cashier_id,p_outlet_id);
  if p_to <= p_from or p_prev_to <= p_prev_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal terlalu panjang'; end if;

  with tx as (
    select id, total, payment_method, created_at
    from public.transactions
    where cashier_id=p_cashier_id and outlet_id=p_outlet_id and status='completed'
      and created_at >= p_from and created_at < p_to
  ),
  totals as (
    select count(*)::int as cnt,
           coalesce(sum(total),0) as sales,
           coalesce(sum(total) filter (where payment_method='cash'),0) as cash,
           coalesce(sum(total) filter (where payment_method='qris'),0) as qris
    from tx
  ),
  hourly as (
    select extract(hour from created_at at time zone 'Asia/Jakarta')::int as hour, sum(total) as total
    from tx group by 1
  ),
  items as (
    -- Menu dengan nama sama (mis. menu sementara) digabung per station.
    select min(pr.name) as name, pr.station,
           sum(ti.quantity) as qty, sum(ti.subtotal) as subtotal
    from public.transaction_items ti
    join tx on tx.id=ti.transaction_id
    join public.products pr on pr.id=ti.product_id
    group by lower(btrim(pr.name)), pr.station
  )
  select jsonb_build_object(
    'count',         t.cnt,
    'sales',         t.sales,
    'cash',          t.cash,
    'qris',          t.qris,
    'totalItems',    coalesce((select sum(qty) from items),0),
    'menuCount',     (select count(*) from items),
    'previousSales', coalesce((
      select sum(total) from public.transactions
      where cashier_id=p_cashier_id and outlet_id=p_outlet_id and status='completed'
        and created_at >= p_prev_from and created_at < p_prev_to
    ),0),
    'hourly', coalesce((select jsonb_agg(jsonb_build_object('hour',h.hour,'total',h.total) order by h.hour) from hourly h),'[]'::jsonb),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('name',x.name,'station',x.station,'qty',x.qty,'subtotal',x.subtotal) order by x.qty desc, x.subtotal desc, x.name)
      from (select * from items order by qty desc, subtotal desc, name limit 10) x
    ),'[]'::jsonb)
  ) into result
  from totals t;

  return result;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Laporan shift
-- ---------------------------------------------------------------------------
create or replace function public.get_shift_report(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
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
    select id, total, payment_method
    from public.transactions where shift_id=p_shift_id and status='completed'
  ),
  totals as (
    select count(*)::int as cnt,
           coalesce(sum(total),0) as revenue,
           coalesce(sum(total) filter (where payment_method='cash'),0) as cash,
           coalesce(sum(total) filter (where payment_method='qris'),0) as qris
    from tx
  ),
  lines as (
    select coalesce(pr.category_id::text,'uncategorized') as category_id,
           coalesce(c.name,'Tanpa Kategori') as category_name,
           pr.id as product_id, pr.name as product_name,
           sum(ti.quantity) as qty, sum(ti.subtotal) as total
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
    'totalRevenue',      t.revenue,
    'cashRevenue',       t.cash,
    'qrisRevenue',       t.qris,
    'totalTransactions', t.cnt,
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
  from totals t;

  return result;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Daftar bill ringkas (tanpa item) + paginasi
--    Bill ditahan: total & jumlah item = SISA setelah dikurangi bagian split yang sudah dibayar.
-- ---------------------------------------------------------------------------
create or replace function public.list_shift_bills(
  p_shift_id uuid,
  p_status text,
  p_search text default '',
  p_limit int default 30,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  s public.shifts%rowtype;
  q text := '%' || lower(btrim(coalesce(p_search,''))) || '%';
  lim int := least(greatest(coalesce(p_limit,30),1),100);
  off int := greatest(coalesce(p_offset,0),0);
  rows jsonb;
  cnt_completed int;
  cnt_held int;
begin
  if p_status not in ('completed','held') then raise exception 'Status bill tidak valid'; end if;
  select * into s from public.shifts where id=p_shift_id;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(s.cashier_id,s.outlet_id);

  select count(*) filter (where status='completed'), count(*) filter (where status='held')
    into cnt_completed, cnt_held
  from public.transactions where shift_id=p_shift_id and status in ('completed','held');

  with page as (
    select t.*
    from public.transactions t
    where t.shift_id=p_shift_id and t.status::text=p_status
      and (q='%%' or lower(t.number||' '||t.customer_name||' '||t.table_number) like q)
    order by t.created_at desc, t.id
    limit lim offset off
  ),
  parent as (
    select ti.transaction_id, ti.product_id, sum(ti.quantity) as qty, max(ti.selling_price_unit) as price
    from public.transaction_items ti join page p on p.id=ti.transaction_id
    group by 1,2
  ),
  allocated as (
    select c.parent_transaction_id as transaction_id, ci.product_id, sum(ci.quantity) as qty
    from public.transactions c
    join public.transaction_items ci on ci.transaction_id=c.id
    where c.parent_transaction_id in (select id from page) and c.status='completed'
    group by 1,2
  ),
  remaining as (
    select p.transaction_id,
           greatest(p.qty - coalesce(a.qty,0),0) as qty,
           greatest(p.qty - coalesce(a.qty,0),0) * p.price as amount
    from parent p
    left join allocated a on a.transaction_id=p.transaction_id and a.product_id=p.product_id
  ),
  agg as (select transaction_id, sum(qty) as qty, sum(amount) as amount from remaining group by 1)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',            p.id,
    'number',        p.number,
    'customerName',  p.customer_name,
    'customerPhone', p.customer_phone,
    'table',         p.table_number,
    'status',        p.status,
    'total',         case when p.status='held' then coalesce(a.amount,0) else p.total end,
    'paymentMethod', p.payment_method,
    'createdAt',     p.created_at,
    'itemCount',     case when p.status='held' then coalesce(a.qty,0)
                          else coalesce((select sum(ti.quantity) from public.transaction_items ti where ti.transaction_id=p.id),0) end
  ) order by p.created_at desc, p.id),'[]'::jsonb)
  into rows
  from page p left join agg a on a.transaction_id=p.id;

  return jsonb_build_object('rows',rows,'completedCount',cnt_completed,'heldCount',cnt_held);
end $$;

-- ---------------------------------------------------------------------------
-- 4) Item satu bill (dimuat saat detail dibuka)
--    Bill ditahan: item SISA; bill selesai: item apa adanya.
-- ---------------------------------------------------------------------------
create or replace function public.get_bill_items(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.transactions%rowtype;
begin
  select * into t from public.transactions where id=p_transaction_id;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id,t.outlet_id);

  if t.status='held' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId',x->>'productId','productName',x->>'name','station',x->>'station',
        'quantity',(x->>'quantity')::numeric,'unitPrice',(x->>'unitPrice')::numeric,
        'subtotal',(x->>'quantity')::numeric*(x->>'unitPrice')::numeric))
      from jsonb_array_elements(public.get_held_bill_items(p_transaction_id)) x
    ),'[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'productId',ti.product_id,'productName',pr.name,'station',pr.station,
      'quantity',ti.quantity,'unitPrice',ti.selling_price_unit,'subtotal',ti.subtotal) order by pr.name, ti.id)
    from public.transaction_items ti join public.products pr on pr.id=ti.product_id
    where ti.transaction_id=p_transaction_id
  ),'[]'::jsonb);
end $$;

revoke execute on function public.get_dashboard_summary(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public, anon;
revoke execute on function public.get_shift_report(uuid)                         from public, anon;
revoke execute on function public.list_shift_bills(uuid,text,text,int,int)       from public, anon;
revoke execute on function public.get_bill_items(uuid)                           from public, anon;
grant  execute on function public.get_dashboard_summary(uuid,uuid,timestamptz,timestamptz,timestamptz,timestamptz) to authenticated;
grant  execute on function public.get_shift_report(uuid)                         to authenticated;
grant  execute on function public.list_shift_bills(uuid,text,text,int,int)       to authenticated;
grant  execute on function public.get_bill_items(uuid)                           to authenticated;
