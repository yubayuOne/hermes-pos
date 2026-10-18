-- COLOONY 028: akses owner untuk backoffice (baca data, katalog di outlet tanpa kasir, laporan lintas outlet).
-- Catatan keamanan: perangkat POS login dengan akun owner yang sama, jadi database tidak dapat membedakan "kasir" dari
-- "owner" pada level akun. Batas hak kasir dijaga di aplikasi (menu yang ditampilkan); batas antar bisnis dijaga di sini.

-- Apakah akun yang login adalah owner dari outlet ini.
create or replace function public.is_owner_of_outlet(p_outlet_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.outlets o
    join public.business_members m on m.business_id = o.business_id
    where o.id = p_outlet_id and m.auth_user_id = auth.uid() and m.role = 'owner'
  )
$$;

-- Hak mengubah katalog outlet: owner outlet itu, atau akun yang punya kasir aktif di outlet itu (perilaku lama).
-- Dengan ini owner dapat menyiapkan produk outlet baru sebelum ada kasir.
create or replace function public.assert_catalog_access(p_outlet_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Belum login'; end if;
  if public.is_owner_of_outlet(p_outlet_id) then return; end if;
  if exists (select 1 from public.cashier_sessions where auth_user_id = auth.uid() and outlet_id = p_outlet_id and is_active) then return; end if;
  raise exception 'Sesi kasir tidak valid';
end $$;

-- Fungsi katalog yang sudah ada, hanya pemeriksaan aksesnya diganti assert_catalog_access (isi lain tidak berubah).
CREATE OR REPLACE FUNCTION public.create_category(p_outlet_id uuid, p_name text, p_sort_order integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cid uuid;
begin
  perform public.assert_catalog_access(p_outlet_id);

  if nullif(trim(p_name), '') is null then
    raise exception 'Nama kategori wajib diisi';
  end if;

  if p_sort_order < 0 then
    raise exception 'Urutan kategori tidak valid';
  end if;

  insert into public.categories(outlet_id, name, sort_order, is_active)
  values (p_outlet_id, trim(p_name), p_sort_order, true)
  returning id into cid;

  return cid;
exception
  when unique_violation then
    raise exception 'Nama kategori sudah digunakan';
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_product(p_outlet_id uuid, p_category_id uuid, p_name text, p_hpp numeric, p_selling_price numeric, p_stock numeric DEFAULT 0, p_station product_station DEFAULT 'kitchen'::product_station)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pid uuid;
  cashier uuid;
begin
  perform public.assert_catalog_access(p_outlet_id);

  if nullif(trim(p_name), '') is null then
    raise exception 'Nama produk wajib diisi';
  end if;

  if p_hpp < 0 or p_selling_price < 0 or p_stock < 0 then
    raise exception 'HPP, harga jual, dan stok tidak boleh negatif';
  end if;

  if p_category_id is not null and not exists (
    select 1
    from public.categories
    where id = p_category_id
      and outlet_id = p_outlet_id
      and is_active = true
  ) then
    raise exception 'Kategori tidak ditemukan';
  end if;

  insert into public.products(
    outlet_id,
    category_id,
    name,
    hpp,
    selling_price,
    stock,
    station,
    is_active
  )
  values (
    p_outlet_id,
    p_category_id,
    trim(p_name),
    p_hpp,
    p_selling_price,
    p_stock,
    p_station,
    true
  )
  returning id into pid;

  return pid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_category(p_category_id uuid, p_outlet_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cid uuid;
begin
  perform public.assert_catalog_access(p_outlet_id);

  update public.categories
  set is_active = false
  where id = p_category_id
    and outlet_id = p_outlet_id
    and is_active = true
  returning id into cid;

  if cid is null then
    raise exception 'Kategori tidak ditemukan';
  end if;

  -- Products keep their category reference for historical integrity;
  -- inactive categories simply stop appearing in the cashier catalog.
  return cid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_product(p_product_id uuid, p_outlet_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pid uuid;
begin
  perform public.assert_catalog_access(p_outlet_id);

  update public.products
  set is_active = false
  where id = p_product_id
    and outlet_id = p_outlet_id
    and is_active = true
  returning id into pid;

  if pid is null then
    raise exception 'Produk tidak ditemukan';
  end if;

  return pid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_category(p_category_id uuid, p_outlet_id uuid, p_name text, p_sort_order integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cid uuid;
  cashier uuid;
begin
  perform public.assert_catalog_access(p_outlet_id);

  if nullif(trim(p_name), '') is null then
    raise exception 'Nama kategori wajib diisi';
  end if;

  update public.categories
  set name = trim(p_name),
      sort_order = p_sort_order
  where id = p_category_id
    and outlet_id = p_outlet_id
    and is_active = true
  returning id into cid;

  if cid is null then
    raise exception 'Kategori tidak ditemukan';
  end if;

  return cid;
exception
  when unique_violation then
    raise exception 'Nama kategori sudah digunakan';
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_product(p_product_id uuid, p_outlet_id uuid, p_category_id uuid, p_name text, p_hpp numeric, p_selling_price numeric, p_stock numeric, p_station product_station)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pid uuid;
  cashier uuid;
begin
  perform public.assert_catalog_access(p_outlet_id);

  if nullif(trim(p_name), '') is null then
    raise exception 'Nama produk wajib diisi';
  end if;

  if p_hpp < 0 or p_selling_price < 0 or p_stock < 0 then
    raise exception 'HPP, harga jual, dan stok tidak boleh negatif';
  end if;

  if p_category_id is not null and not exists (
    select 1
    from public.categories
    where id = p_category_id
      and outlet_id = p_outlet_id
      and is_active = true
  ) then
    raise exception 'Kategori tidak ditemukan';
  end if;

  update public.products
  set category_id = p_category_id,
      name = trim(p_name),
      hpp = p_hpp,
      selling_price = p_selling_price,
      stock = p_stock,
      station = p_station
  where id = p_product_id
    and outlet_id = p_outlet_id
    and is_active = true
  returning id into pid;

  if pid is null then
    raise exception 'Produk tidak ditemukan';
  end if;

  return pid;
end;
$function$;


-- Owner boleh MEMBACA data operasional semua outlet bisnisnya (backoffice). Menulis tetap lewat RPC.
drop policy if exists "owner reads categories" on public.categories;
create policy "owner reads categories" on public.categories for select using (public.is_owner_of_outlet(outlet_id));
drop policy if exists "owner reads products" on public.products;
create policy "owner reads products" on public.products for select using (public.is_owner_of_outlet(outlet_id));
drop policy if exists "owner reads shifts" on public.shifts;
create policy "owner reads shifts" on public.shifts for select using (public.is_owner_of_outlet(outlet_id));
drop policy if exists "owner reads transactions" on public.transactions;
create policy "owner reads transactions" on public.transactions for select using (public.is_owner_of_outlet(outlet_id));
drop policy if exists "owner reads cash ledger" on public.cash_ledger;
create policy "owner reads cash ledger" on public.cash_ledger for select using (public.is_owner_of_outlet(outlet_id));
drop policy if exists "owner reads transaction items" on public.transaction_items;
create policy "owner reads transaction items" on public.transaction_items for select using (
  exists (select 1 from public.transactions t where t.id = transaction_items.transaction_id and public.is_owner_of_outlet(t.outlet_id))
);
drop policy if exists "owner reads payments" on public.payments;
create policy "owner reads payments" on public.payments for select using (
  exists (select 1 from public.transactions t where t.id = payments.transaction_id and public.is_owner_of_outlet(t.outlet_id))
);

-- Ringkasan penjualan lintas outlet (p_outlet_id null = semua outlet bisnis) dan semua kasir.
-- Hanya bill selesai yang dihitung sebagai penjualan; bill batal dilaporkan terpisah.
create or replace function public.owner_sales_summary(
  p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); result jsonb;
begin
  if p_outlet_id is not null and not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_to <= p_from or p_prev_to <= p_prev_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal terlalu panjang'; end if;

  with scope as (
    select o.id, o.name from public.outlets o where o.business_id = b and (p_outlet_id is null or o.id = p_outlet_id)
  ),
  tx as (
    select t.id, t.outlet_id, t.cashier_id, t.total, t.total_hpp, t.payment_method, t.created_at, t.item_discount, t.bill_discount
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'completed' and t.created_at >= p_from and t.created_at < p_to
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
  items as (
    select min(pr.name) as name, pr.station, sum(ti.quantity) as qty, sum(ti.net_subtotal) as subtotal
    from public.transaction_items ti
    join tx on tx.id = ti.transaction_id
    join public.products pr on pr.id = ti.product_id
    group by lower(btrim(pr.name)), pr.station
  ),
  prev as (
    select count(*)::int as cnt, coalesce(sum(t.total), 0) as sales
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'completed' and t.created_at >= p_prev_from and t.created_at < p_prev_to
  ),
  voided as (
    select count(*)::int as cnt, coalesce(sum(t.total), 0) as total
    from public.transactions t join scope s on s.id = t.outlet_id
    where t.status = 'voided' and t.created_at >= p_from and t.created_at < p_to
  )
  select jsonb_build_object(
    'count', t.cnt,
    'sales', t.sales,
    'profit', t.sales - t.hpp,
    'cash', t.cash,
    'qris', t.qris,
    'discountTotal', t.discount,
    'totalItems', coalesce((select sum(qty) from items), 0),
    'menuCount', (select count(*) from items),
    'previousSales', (select sales from prev),
    'previousCount', (select cnt from prev),
    'voidedCount', (select cnt from voided),
    'voidedTotal', (select total from voided),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'count', d.cnt, 'total', d.total) order by d.day)
      from (select (created_at at time zone 'Asia/Jakarta')::date as day, count(*)::int as cnt, sum(total) as total from tx group by 1) d
    ), '[]'::jsonb),
    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h.hour, 'total', h.total) order by h.hour)
      from (select extract(hour from created_at at time zone 'Asia/Jakarta')::int as hour, sum(total) as total from tx group by 1) h
    ), '[]'::jsonb),
    'byOutlet', coalesce((
      select jsonb_agg(jsonb_build_object('outletId', s.id, 'name', s.name, 'count', coalesce(x.cnt, 0), 'sales', coalesce(x.sales, 0)) order by s.name)
      from scope s left join (select outlet_id, count(*)::int as cnt, sum(total) as sales from tx group by 1) x on x.outlet_id = s.id
    ), '[]'::jsonb),
    'byCashier', coalesce((
      select jsonb_agg(jsonb_build_object('cashierId', x.cashier_id, 'name', coalesce(cs.cashier_name, 'Kasir dihapus'), 'count', x.cnt, 'sales', x.sales) order by x.sales desc)
      from (select cashier_id, count(*)::int as cnt, sum(total) as sales from tx group by 1) x
      left join public.cashier_sessions cs on cs.cashier_id = x.cashier_id
    ), '[]'::jsonb),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'station', x.station, 'qty', x.qty, 'subtotal', x.subtotal) order by x.qty desc, x.subtotal desc, x.name)
      from (select * from items order by qty desc, subtotal desc, name limit 10) x
    ), '[]'::jsonb)
  ) into result
  from totals t;
  return result;
end $$;

-- Daftar bill lintas outlet dengan paginasi. p_status: completed | held | voided | all.
create or replace function public.owner_list_bills(
  p_outlet_id uuid, p_from timestamptz, p_to timestamptz,
  p_status text default 'completed', p_search text default null, p_limit integer default 50, p_offset integer default 0
) returns jsonb
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
        'voidReason', r.void_reason, 'discount', r.discount) order by r.created_at desc, r.id)
      from (
        select f.id, f.number, f.status, f.total, f.payment_method, f.created_at, f.customer_name, f.table_number,
               f.outlet_id, o.name as outlet_name, coalesce(cs.cashier_name, 'Kasir dihapus') as cashier_name,
               f.void_reason, f.item_discount + f.bill_discount as discount
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

-- Item satu bill (untuk bill ditahan: item yang tersimpan, belum dikurangi bagian Split Bill).
create or replace function public.owner_get_bill_items(p_transaction_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.transactions%rowtype;
begin
  perform public.require_owner_business();
  select * into t from public.transactions where id = p_transaction_id;
  if not found or not public.is_owner_of_outlet(t.outlet_id) then raise exception 'Bill tidak ditemukan'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'productId', ti.product_id, 'productName', pr.name, 'station', pr.station,
      'quantity', ti.quantity, 'unitPrice', ti.selling_price_unit, 'subtotal', ti.subtotal,
      'discount', ti.discount_amount, 'note', ti.note) order by pr.name, ti.id)
    from public.transaction_items ti join public.products pr on pr.id = ti.product_id
    where ti.transaction_id = p_transaction_id
  ), '[]'::jsonb);
end $$;

revoke all on function public.is_owner_of_outlet(uuid) from public, anon;
revoke all on function public.assert_catalog_access(uuid) from public, anon, authenticated;
revoke all on function public.owner_sales_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
revoke all on function public.owner_list_bills(uuid, timestamptz, timestamptz, text, text, integer, integer) from public, anon;
revoke all on function public.owner_get_bill_items(uuid) from public, anon;
grant execute on function public.is_owner_of_outlet(uuid) to authenticated;
grant execute on function public.owner_sales_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;
grant execute on function public.owner_list_bills(uuid, timestamptz, timestamptz, text, text, integer, integer) to authenticated;
grant execute on function public.owner_get_bill_items(uuid) to authenticated;
