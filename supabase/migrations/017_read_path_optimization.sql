-- KASBOX 017: Read-path optimization
-- Tujuan: mengurangi jumlah request dan ukuran payload dari terminal kasir.
--   1) get_shift_dashboard      : ringkasan dashboard dihitung di database (1 request, < 2 KB)
--                                 menggantikan unduh seluruh transaksi shift + item.
--   2) get_held_bill_items      : sisa item held/split bill dihitung di server (1 request)
--                                 menggantikan 2 query + penggabungan di klien.
--   3) recall_held_bill_with_items : recall + sisa item dalam 1 request (sebelumnya 3).
--   4) index parent_transaction_id : mempercepat pencarian child split bill.
-- Semua fungsi read-only terhadap data bisnis (recall hanya mengambil row lock yang sama
-- seperti recall_held_bill sebelumnya) dan memakai assert_cashier seperti
-- get_shift_cash_summary.

create index if not exists transactions_parent_idx
  on public.transactions(parent_transaction_id)
  where parent_transaction_id is not null;

-- ---------------------------------------------------------------------------
-- 1) Sisa item bill (held / split) setelah dikurangi child yang sudah dibayar.
--    Logika identik dengan fetchHeldBillItems() di klien:
--    - baris produk yang sama digabung (jumlah qty dijumlahkan)
--    - qty child berstatus 'completed' dikurangkan per produk
--    - hanya qty sisa > 0 yang dikembalikan
--    - stock = max(stok produk saat ini, qty sisa)
-- ---------------------------------------------------------------------------
create or replace function public.get_held_bill_items(p_transaction_id uuid)
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

  return coalesce((
    with parent as (
      select ti.product_id,
             sum(ti.quantity)           as qty,
             max(ti.hpp_unit)           as hpp_unit,
             max(ti.selling_price_unit) as price_unit
      from public.transaction_items ti
      where ti.transaction_id=p_transaction_id
      group by ti.product_id
    ),
    allocated as (
      select ci.product_id, sum(ci.quantity) as qty
      from public.transactions c
      join public.transaction_items ci on ci.transaction_id=c.id
      where c.parent_transaction_id=p_transaction_id
        and c.status='completed'
      group by ci.product_id
    ),
    remaining as (
      select p.product_id,
             p.hpp_unit,
             p.price_unit,
             p.qty - coalesce(a.qty,0) as qty
      from parent p
      left join allocated a on a.product_id=p.product_id
    )
    select jsonb_agg(
             jsonb_build_object(
               'productId', r.product_id,
               'name',      pr.name,
               'unitPrice', r.price_unit,
               'hpp',       r.hpp_unit,
               'quantity',  r.qty,
               'stock',     greatest(pr.stock, r.qty),
               'station',   pr.station
             )
             order by pr.name, r.product_id
           )
    from remaining r
    join public.products pr on pr.id=r.product_id
    where r.qty > 0
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 2) Recall + item dalam satu panggilan. Header sama persis dengan
--    recall_held_bill(); ditambah kunci 'items'.
-- ---------------------------------------------------------------------------
create or replace function public.recall_held_bill_with_items(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  header jsonb;
begin
  header := public.recall_held_bill(p_transaction_id);
  return header || jsonb_build_object('items', public.get_held_bill_items(p_transaction_id));
end $$;

-- ---------------------------------------------------------------------------
-- 3) Ringkasan dashboard shift. Hanya transaksi berstatus 'completed'.
--    - sales/cash/qris : jumlah total (payment_method pada transaksi)
--    - hourly          : total per jam (zona Asia/Jakarta, berdasarkan created_at)
--    - topKitchen/topBar : 5 produk teratas per station berdasarkan subtotal
--    - best            : produk terlaris lintas station (untuk teks insight)
-- ---------------------------------------------------------------------------
create or replace function public.get_shift_dashboard(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  s public.shifts%rowtype;
  result jsonb;
begin
  select * into s from public.shifts where id=p_shift_id;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(s.cashier_id,s.outlet_id);

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
    select extract(hour from created_at at time zone 'Asia/Jakarta')::int as hour,
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
end $$;

revoke execute on function public.get_held_bill_items(uuid)          from public, anon;
revoke execute on function public.recall_held_bill_with_items(uuid)  from public, anon;
revoke execute on function public.get_shift_dashboard(uuid)          from public, anon;
grant  execute on function public.get_held_bill_items(uuid)          to authenticated;
grant  execute on function public.recall_held_bill_with_items(uuid)  to authenticated;
grant  execute on function public.get_shift_dashboard(uuid)          to authenticated;
