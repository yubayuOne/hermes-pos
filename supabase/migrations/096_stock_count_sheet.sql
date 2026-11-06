-- Stock count sheet (kitchen-sheet style): a count (opname) can be made for any day, not only today.
-- A row holds opening (Awal), received (Masuk), issued (Keluar), counted (Akhir), the system stock at that moment
-- (book_qty), and a note. Selisih (variance) = counted - (opening + received - issued), computed when read.
-- Received and issued are kept on the row only: stock still changes through stock_documents, and the adjustment
-- is counted - system stock. A count for a past day is dated 23:59:59.999999 in the business time zone, and its
-- adjustment carries that moment, so movements after it stay on top. Only the count sheet can count now:
-- owner_stock_document no longer takes 'opname', so opening is always set.

alter table public.stock_document_lines
  add column if not exists opening numeric not null default 0,
  add column if not exists received numeric not null default 0 check (received >= 0),
  add column if not exists issued numeric not null default 0 check (issued >= 0),
  add column if not exists note text not null default '' check (char_length(note) <= 200);
-- Counts made before this migration: the opening is the system stock the count was compared with.
update public.stock_document_lines l set opening = coalesce(l.book_qty, 0)
from public.stock_documents d where d.id = l.document_id and d.kind = 'opname';

-- Start of a business day, and the last moment of it (23:59:59.999999), in the outlet's time zone.
create or replace function public.stock_day_start(p_outlet_id uuid, p_date date)
returns timestamptz language sql stable set search_path = public as $$
  select p_date::timestamp at time zone public.outlet_tz(p_outlet_id)
$$;
create or replace function public.stock_day_end(p_outlet_id uuid, p_date date)
returns timestamptz language sql stable set search_path = public as $$
  select (p_date + 1)::timestamp at time zone public.outlet_tz(p_outlet_id) - interval '1 microsecond'
$$;

-- The stock a product had at a moment: the last opening, initial, or count before it, plus every move after that
-- count up to the moment. Internal: the owner functions below call it.
create or replace function public.stock_book_at(p_product_id uuid, p_at timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(b.counted, 0) + coalesce((
    select sum(sm.qty) from public.stock_moves sm where sm.product_id = p_product_id and sm.at > b.at and sm.at <= p_at
  ), 0)
  from (select 1) x
  left join lateral (
    select l.counted, d.created_at as at from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id
    where l.product_id = p_product_id and d.kind in ('opening', 'initial', 'opname') and d.created_at <= p_at
    order by d.created_at desc, d.id desc limit 1
  ) b on true
$$;
revoke all on function public.stock_day_start(uuid, date) from public, anon, authenticated;
revoke all on function public.stock_day_end(uuid, date) from public, anon, authenticated;
revoke all on function public.stock_book_at(uuid, timestamptz) from public, anon, authenticated;

-- Opening (Awal) per tracked product for a day: the count made before that day, or null when the product was never
-- counted (then the admin types it). Returns [{id, opening}].
create or replace function public.owner_stock_openings(p_outlet_id uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_start timestamptz;
begin
  perform public.require_owner_business();
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  v_start := public.stock_day_start(p_outlet_id, coalesce(p_date, (now() at time zone public.outlet_tz(p_outlet_id))::date));
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'opening', (
      select l.counted from public.stock_document_lines l join public.stock_documents d on d.id = l.document_id
      where l.product_id = p.id and d.kind = 'opname' and d.created_at < v_start
      order by d.created_at desc, d.id desc limit 1)) order by p.name)
    from public.products p
    where p.outlet_id = p_outlet_id and p.track_stock and not p.is_temporary
  ), '[]'::jsonb);
end $$;

-- Saves one count sheet for a day (null = today). p_lines: [{productId, opening, received, issued, counted, note}];
-- a row with counted null is skipped; null received or issued is 0. The opening from the server wins when the product
-- has a count before the day; the typed one is used only for a product never counted.
create or replace function public.owner_stock_opname_sheet(p_outlet_id uuid, p_lines jsonb, p_date date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_tz text := public.outlet_tz(p_outlet_id);
  v_today date;
  v_date date;
  v_start timestamptz;
  v_at timestamptz;
  d public.stock_documents%rowtype;
  x record;
  p public.products%rowtype;
  v_opening numeric;
  v_book numeric;
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mengubah stok'); end if;
  v_today := (now() at time zone v_tz)::date;
  v_date := coalesce(p_date, v_today);
  if v_date > v_today then raise exception 'Tanggal stok opname tidak boleh setelah hari ini'; end if;
  v_start := public.stock_day_start(p_outlet_id, v_date);
  v_at := case when v_date = v_today then now() else public.stock_day_end(p_outlet_id, v_date) end;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Isi minimal satu produk'; end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'Maksimal 500 produk dalam satu dokumen'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
             where jsonb_typeof(e) <> 'object'
               or coalesce(e->>'productId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               or (e->>'opening' is not null and e->>'opening' !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$')
               or (e->>'received' is not null and e->>'received' !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$')
               or (e->>'issued' is not null and e->>'issued' !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$')
               or (e->>'counted' is not null and e->>'counted' !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$')
               or char_length(coalesce(e->>'note', '')) > 200) then
    raise exception 'Data produk tidak valid';
  end if;
  if (select count(*) <> count(distinct e->>'productId') from jsonb_array_elements(p_lines) e) then raise exception 'Satu produk hanya boleh sekali'; end if;
  if not exists (select 1 from jsonb_array_elements(p_lines) e where e->>'counted' is not null) then
    raise exception 'Isi hasil hitung minimal satu produk';
  end if;

  insert into public.stock_documents(outlet_id, kind, reason, created_by, created_at)
  values (p_outlet_id, 'opname', '', auth.uid(), v_at) returning * into d;
  -- Products in id order, the same lock order as checkout.
  for x in
    select (e->>'productId')::uuid as product_id, nullif(e->>'opening', '')::numeric as opening_in,
      coalesce((e->>'received')::numeric, 0) as received, coalesce((e->>'issued')::numeric, 0) as issued,
      (e->>'counted')::numeric as counted, coalesce(e->>'note', '') as note
    from jsonb_array_elements(p_lines) e where e->>'counted' is not null order by 1
  loop
    select * into p from public.products where id = x.product_id and outlet_id = p_outlet_id for update;
    if not found then raise exception 'Produk tidak ditemukan di outlet ini'; end if;
    if not p.track_stock then raise exception 'Ada produk yang stoknya tidak dilacak. Aktifkan Lacak stok di data produk dulu.'; end if;
    if exists (select 1 from public.stock_document_lines l join public.stock_documents sd on sd.id = l.document_id
               where l.product_id = p.id and sd.kind in ('opening', 'initial', 'opname') and sd.created_at > v_at) then
      raise exception 'Sudah ada stok opname % setelah tanggal ini.', p.name;
    end if;
    v_book := public.stock_book_at(p.id, v_at);
    v_opening := (select l.counted from public.stock_document_lines l join public.stock_documents sd on sd.id = l.document_id
                  where l.product_id = p.id and sd.kind = 'opname' and sd.created_at < v_start
                  order by sd.created_at desc, sd.id desc limit 1);
    if v_opening is null then v_opening := coalesce(x.opening_in, public.stock_book_at(p.id, v_start)); end if;
    if p.stock + (x.counted - v_book) < 0 then raise exception 'Stok % tidak cukup.', p.name; end if;
    update public.products set stock = stock + (x.counted - v_book) where id = p.id;
    insert into public.stock_document_lines(document_id, product_id, qty, counted, book_qty, hpp_unit, opening, received, issued, note)
    values (d.id, p.id, x.counted - v_book, x.counted, v_book, p.hpp, v_opening, x.received, x.issued, x.note);
  end loop;
  return public.stock_document_json(d.id);
end $$;

-- The document JSON now carries the sheet columns and the difference (variance) for counts.
create or replace function public.stock_document_json(p_document_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', d.id, 'kind', d.kind, 'reason', d.reason, 'createdAt', d.created_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('productId', l.product_id, 'productName', p.name, 'qty', l.qty, 'counted', l.counted,
        'bookQty', l.book_qty, 'value', l.qty * l.hpp_unit, 'opening', l.opening, 'received', l.received, 'issued', l.issued,
        'note', l.note, 'variance', case when l.counted is null then null else l.counted - (l.opening + l.received - l.issued) end)
        order by p.name)
      from public.stock_document_lines l join public.products p on p.id = l.product_id
      where l.document_id = d.id), '[]'::jsonb))
  from public.stock_documents d where d.id = p_document_id
$$;
revoke all on function public.stock_document_json(uuid) from public, anon, authenticated;

-- The old count path is closed: counts go through owner_stock_opname_sheet.
-- Same as 074, except that 'opname' is refused.
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
  if p_kind = 'opname' then raise exception 'Hitung stok lewat lembar hitung stok'; end if;
  if p_kind is null or p_kind not in ('stock_in', 'adjustment') then raise exception 'Jenis dokumen stok tidak valid'; end if;
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

  insert into public.stock_documents(outlet_id, kind, reason, created_by) values (p_outlet_id, p_kind, v_reason, auth.uid()) returning * into d;
  -- Products in id order, the same lock order as checkout.
  for x in select (e->>'productId')::uuid as product_id, (e->>'qty')::numeric as qty from jsonb_array_elements(p_lines) e order by 1 loop
    select * into p from public.products where id = x.product_id and outlet_id = p_outlet_id for update;
    if not found then raise exception 'Produk tidak ditemukan di outlet ini'; end if;
    if not p.track_stock then raise exception 'Ada produk yang stoknya tidak dilacak. Aktifkan Lacak stok di data produk dulu.'; end if;
    v_delta := x.qty;
    if p.stock + v_delta < 0 then raise exception 'Stok tidak boleh minus. Periksa jumlah yang dikurangi.'; end if;
    update public.products set stock = stock + v_delta where id = p.id;
    insert into public.stock_document_lines(document_id, product_id, qty, counted, book_qty, hpp_unit, opening)
    values (d.id, p.id, v_delta, null, p.stock, p.hpp, p.stock);
  end loop;
  return public.stock_document_json(d.id);
end $$;

revoke all on function public.owner_stock_openings(uuid, date) from public, anon;
revoke all on function public.owner_stock_opname_sheet(uuid, jsonb, date) from public, anon;
grant execute on function public.owner_stock_openings(uuid, date) to authenticated;
grant execute on function public.owner_stock_opname_sheet(uuid, jsonb, date) to authenticated;
