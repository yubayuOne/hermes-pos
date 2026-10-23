-- Ingredient purchases and stock (docs/superpowers/specs/2026-10-23-belanja-stok-bahan-design.md, release B1).
--
-- Stock is kept per ingredient in base units (g, ml, pcs). It runs from the first purchase or first count
-- (stock_started); before that, sales leave the ingredient alone. ingredients.price stays the price of one pack and
-- becomes the moving average once purchases are recorded, so recipe_cost (084) remains the one place HPP is computed.
-- Lock order everywhere: ingredients (by id), then products (by id), as 086.

-- ================================================================ schema, average price, purchases (Task 1)
alter table public.ingredients add column if not exists stock numeric(16,3) not null default 0;
alter table public.ingredients add column if not exists stock_started boolean not null default false;
alter table public.ingredients add column if not exists pack_label text check (char_length(pack_label) <= 20);

-- One row per change of an ingredient's stock. qty is signed, in base units; counted is the count for opening and count.
create table if not exists public.ingredient_moves (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  kind text not null check (kind in ('purchase', 'purchase_cancel', 'sale', 'opening', 'count')),
  qty numeric(16,3) not null,
  counted numeric(16,3),
  doc_id uuid,
  at timestamptz not null default now(),
  created_by uuid
);
create index if not exists ingredient_moves_ingredient on public.ingredient_moves(ingredient_id, at);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  bought_on date not null,
  total numeric(14,2) not null,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  cancel_reason text
);
create index if not exists purchases_outlet on public.purchases(outlet_id, bought_on desc, created_at desc);

create table if not exists public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  packs numeric(14,3) not null check (packs > 0),
  total numeric(14,2) not null check (total >= 0),
  base_qty numeric(16,3) not null,
  price_before numeric(14,2) not null,
  price_after numeric(14,2) not null,
  unique (purchase_id, ingredient_id)
);
create index if not exists purchase_lines_ingredient on public.purchase_lines(ingredient_id);

alter table public.ingredient_moves enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;
revoke all on public.ingredient_moves from public, anon, authenticated;
revoke all on public.purchases from public, anon, authenticated;
revoke all on public.purchase_lines from public, anon, authenticated;

-- The owner of the outlet, not a cashier. Raises the catalog's message so the screens read the same.
create or replace function public.assert_outlet_owner(p_outlet_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business();
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Sesi kasir tidak valid'; end if;
  return b;
end $$;
revoke all on function public.assert_outlet_owner(uuid) from public, anon, authenticated;

-- Recalculates every recipe product that uses any of the ingredients, products in id order.
create or replace function public.recompute_hpp_for(p_ingredient_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  for pid in select distinct product_id from public.recipe_lines where ingredient_id = any(p_ingredient_ids) order by 1 loop
    perform public.recompute_hpp(pid);
  end loop;
end $$;
revoke all on function public.recompute_hpp_for(uuid[]) from public, anon, authenticated;

create or replace function public.purchase_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'boughtOn', p.bought_on, 'total', p.total, 'cancelledAt', p.cancelled_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('ingredientId', l.ingredient_id, 'name', i.name, 'packLabel', i.pack_label, 'packs', l.packs,
        'total', l.total, 'priceBefore', l.price_before, 'priceAfter', l.price_after) order by lower(i.name))
      from public.purchase_lines l join public.ingredients i on i.id = l.ingredient_id where l.purchase_id = p.id), '[]'::jsonb))
  from public.purchases p where p.id = p_id
$$;
revoke all on function public.purchase_json(uuid) from public, anon, authenticated;

-- p_lines: [{"ingredientId", "packs", "total"}]. Adds the stock, moves the average price of each ingredient, starts its
-- stock, and recalculates the HPP of the recipe products that use it. Anything invalid raises and nothing is saved.
create or replace function public.owner_save_purchase(p_outlet_id uuid, p_bought_on date, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.assert_outlet_owner(p_outlet_id);
  today date := (now() at time zone public.outlet_tz(p_outlet_id))::date;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_id uuid;
  ids uuid[];
  x record;
  v_base numeric;
  v_avg numeric;
  v_price numeric;
begin
  if not public.subscription_active(b) then perform public.raise_expired('mencatat belanja'); end if;
  if p_bought_on is null then raise exception 'Tanggal belanja wajib diisi'; end if;
  if p_bought_on > today then raise exception 'Tanggal belanja tidak boleh di masa depan'; end if;
  if p_bought_on < today - 90 then raise exception 'Tanggal belanja paling lama 90 hari ke belakang'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Isi minimal satu bahan'; end if;
  if jsonb_array_length(p_lines) > 50 then raise exception 'Catatan belanja maksimal 50 bahan'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e where jsonb_typeof(e) <> 'object' or coalesce(e ->> 'ingredientId', '') !~* uuid_re) then
    raise exception 'Data belanja tidak valid';
  end if;
  -- At most 6 whole digits keeps packs under 1.000.000.
  if exists (select 1 from jsonb_array_elements(p_lines) e
             where case when coalesce(e ->> 'packs', '') ~ '^[0-9]{1,6}(\.[0-9]{1,3})?$' then (e ->> 'packs')::numeric <= 0 else true end) then
    raise exception 'Jumlah kemasan harus lebih dari 0, sampai 3 desimal, di bawah 1.000.000';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
             where case when coalesce(e ->> 'total', '') ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then (e ->> 'total')::numeric > 1000000000 else true end) then
    raise exception 'Total bayar harus 0 sampai 1.000.000.000';
  end if;
  if (select count(*) <> count(distinct lower(e ->> 'ingredientId')) from jsonb_array_elements(p_lines) e) then
    raise exception 'Satu bahan hanya boleh sekali per catatan belanja';
  end if;
  ids := array(select distinct (e ->> 'ingredientId')::uuid from jsonb_array_elements(p_lines) e);

  perform 1 from public.ingredients where id = any(ids) and outlet_id = p_outlet_id order by id for update;
  if (select count(*) from public.ingredients where id = any(ids) and outlet_id = p_outlet_id) <> cardinality(ids) then
    raise exception 'Bahan tidak ditemukan di outlet ini';
  end if;

  insert into public.purchases(outlet_id, bought_on, total, created_by)
  values (p_outlet_id, p_bought_on, (select sum((e ->> 'total')::numeric) from jsonb_array_elements(p_lines) e), auth.uid())
  returning id into v_id;

  for x in
    select i.*, (e ->> 'packs')::numeric as packs, (e ->> 'total')::numeric as paid, i.pack_qty * public.unit_factor(i.pack_unit) as per_pack
    from jsonb_array_elements(p_lines) e join public.ingredients i on i.id = (e ->> 'ingredientId')::uuid
    order by i.id
  loop
    v_base := round(x.packs * x.per_pack, 3);
    -- Moving average per base unit; an empty or not yet running stock starts over at this purchase's price.
    v_avg := case when x.stock_started and x.stock > 0
                  then (x.stock * x.price / x.per_pack + x.paid) / (x.stock + v_base)
                  else x.paid / v_base end;
    v_price := round(v_avg * x.per_pack, 2);
    insert into public.purchase_lines(purchase_id, ingredient_id, packs, total, base_qty, price_before, price_after)
    values (v_id, x.id, x.packs, x.paid, v_base, x.price, v_price);
    update public.ingredients set stock = stock + v_base, price = v_price, stock_started = true, updated_at = now() where id = x.id;
    insert into public.ingredient_moves(ingredient_id, outlet_id, kind, qty, doc_id, created_by)
    values (x.id, p_outlet_id, 'purchase', v_base, v_id, auth.uid());
  end loop;

  perform public.recompute_hpp_for(ids);
  return public.purchase_json(v_id);
end $$;

-- Only the latest purchase of each of its ingredients can be cancelled: the stock goes down by what it added and the
-- price goes back to the one before it.
create or replace function public.owner_cancel_purchase(p_purchase_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  p public.purchases%rowtype;
  b uuid;
  ids uuid[];
  x record;
begin
  select * into p from public.purchases where id = p_purchase_id;
  if not found then raise exception 'Catatan belanja tidak ditemukan'; end if;
  b := public.assert_outlet_owner(p.outlet_id);
  if char_length(v_reason) < 3 or char_length(v_reason) > 200 then raise exception 'Alasan pembatalan wajib diisi, 3 sampai 200 karakter'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('membatalkan belanja'); end if;

  ids := array(select ingredient_id from public.purchase_lines where purchase_id = p.id);
  perform 1 from public.ingredients where id = any(ids) order by id for update;
  select * into p from public.purchases where id = p_purchase_id for update;
  if p.cancelled_at is not null then raise exception 'Catatan belanja ini sudah dibatalkan'; end if;
  if exists (
    select 1 from public.purchase_lines l join public.purchases q on q.id = l.purchase_id
    where l.ingredient_id = any(ids) and q.id <> p.id and q.cancelled_at is null and q.created_at > p.created_at
  ) then
    raise exception 'Sudah ada belanja setelahnya; batalkan yang terbaru dulu.';
  end if;

  update public.purchases set cancelled_at = now(), cancel_reason = v_reason where id = p.id;
  for x in
    select l.*, i.pack_qty * public.unit_factor(i.pack_unit) as per_pack_now,
      -- Still running if another live purchase or a count is behind it; otherwise back to "not counted".
      exists (select 1 from public.purchase_lines l2 join public.purchases q on q.id = l2.purchase_id
              where l2.ingredient_id = l.ingredient_id and q.id <> p.id and q.cancelled_at is null)
      or exists (select 1 from public.ingredient_moves m where m.ingredient_id = l.ingredient_id and m.kind in ('opening', 'count')) as still_started
    from public.purchase_lines l join public.ingredients i on i.id = l.ingredient_id
    where l.purchase_id = p.id order by l.ingredient_id
  loop
    -- price_before is per the pack size at purchase time (base_qty / packs); the pack may have changed since.
    update public.ingredients
    set stock = case when x.still_started then stock - x.base_qty else 0 end,
        price = round(x.price_before / (x.base_qty / x.packs) * x.per_pack_now, 2),
        stock_started = x.still_started, updated_at = now()
    where id = x.ingredient_id;
    insert into public.ingredient_moves(ingredient_id, outlet_id, kind, qty, doc_id, created_by)
    values (x.ingredient_id, p.outlet_id, 'purchase_cancel', -x.base_qty, p.id, auth.uid());
  end loop;

  perform public.recompute_hpp_for(ids);
  return public.purchase_json(p.id);
end $$;

-- Purchases of the outlet, newest first, 50 a page.
create or replace function public.owner_list_purchases(p_outlet_id uuid, p_page integer default 1)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare off integer := (greatest(coalesce(p_page, 1), 1) - 1) * 50;
begin
  perform public.assert_outlet_owner(p_outlet_id);
  return jsonb_build_object(
    'total', (select count(*) from public.purchases where outlet_id = p_outlet_id),
    'rows', coalesce((
      select jsonb_agg(public.purchase_json(q.id) order by q.bought_on desc, q.created_at desc)
      from (select id, bought_on, created_at from public.purchases where outlet_id = p_outlet_id
            order by bought_on desc, created_at desc limit 50 offset off) q
    ), '[]'::jsonb));
end $$;

revoke all on function public.owner_save_purchase(uuid, date, jsonb) from public, anon;
revoke all on function public.owner_cancel_purchase(uuid, text) from public, anon;
revoke all on function public.owner_list_purchases(uuid, integer) from public, anon;
grant execute on function public.owner_save_purchase(uuid, date, jsonb) to authenticated;
grant execute on function public.owner_cancel_purchase(uuid, text) to authenticated;
grant execute on function public.owner_list_purchases(uuid, integer) to authenticated;

-- ---------------------------------------------------------------- ingredient functions with stock (replace 084)
create or replace function public.owner_list_ingredients(p_outlet_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_catalog_access(p_outlet_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.name, 'price', i.price, 'packQty', i.pack_qty, 'packUnit', i.pack_unit,
      'unitCost', i.price / (i.pack_qty * public.unit_factor(i.pack_unit)),
      'baseUnit', case public.unit_family(i.pack_unit) when 'mass' then 'g' when 'volume' then 'ml' else 'pcs' end,
      'usedBy', (select count(*) from public.recipe_lines r where r.ingredient_id = i.id),
      'stock', i.stock, 'stockStarted', i.stock_started, 'packLabel', i.pack_label,
      'lastCountedAt', (select max(m.at) from public.ingredient_moves m where m.ingredient_id = i.id and m.kind in ('opening', 'count'))
    ) order by lower(i.name))
    from public.ingredients i where i.outlet_id = p_outlet_id), '[]'::jsonb);
end $$;

-- Once the stock runs the price follows the purchases: the typed price must stay the same, and a new pack size
-- reprices the pack from the same average per base unit.
create or replace function public.ingredient_running_price(cur public.ingredients, p_price numeric, p_pack_qty numeric, p_pack_unit text)
returns numeric language plpgsql immutable as $$
begin
  if not cur.stock_started then return p_price; end if;
  if p_price is distinct from cur.price then raise exception 'Harga bahan ini mengikuti catatan belanja. Catat belanja untuk mengubahnya.'; end if;
  return round(cur.price / (cur.pack_qty * public.unit_factor(cur.pack_unit)) * p_pack_qty * public.unit_factor(p_pack_unit), 2);
end $$;
revoke all on function public.ingredient_running_price(public.ingredients, numeric, numeric, text) from public, anon, authenticated;

drop function if exists public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text);
-- p_id null creates. A change recalculates every recipe product that uses the ingredient. p_pack_label blank = "kemasan".
create or replace function public.owner_save_ingredient(p_outlet_id uuid, p_id uuid, p_name text, p_price numeric, p_pack_qty numeric, p_pack_unit text,
  p_pack_label text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_label text := nullif(btrim(coalesce(p_pack_label, '')), '');
  cur public.ingredients%rowtype;
  iid uuid;
begin
  perform public.assert_catalog_access(p_outlet_id);
  if v_name = '' then raise exception 'Nama bahan wajib diisi'; end if;
  if char_length(v_name) > 60 then raise exception 'Nama bahan maksimal 60 karakter'; end if;
  if char_length(v_label) > 20 then raise exception 'Nama kemasan maksimal 20 karakter'; end if;
  perform public.ingredient_check_pack(p_price, p_pack_qty, p_pack_unit);
  if p_id is null then
    insert into public.ingredients(outlet_id, name, price, pack_qty, pack_unit, pack_label) values (p_outlet_id, v_name, p_price, p_pack_qty, p_pack_unit, v_label)
    returning id into iid;
    return iid;
  end if;
  select * into cur from public.ingredients where id = p_id and outlet_id = p_outlet_id for update;
  if not found then raise exception 'Bahan tidak ditemukan'; end if;
  perform public.ingredient_check_family(p_id, cur.pack_unit, p_pack_unit);
  update public.ingredients
  set name = v_name, price = public.ingredient_running_price(cur, p_price, p_pack_qty, p_pack_unit), pack_qty = p_pack_qty, pack_unit = p_pack_unit,
      pack_label = v_label, updated_at = now()
  where id = p_id;
  perform public.recompute_hpp_for(array[p_id]);
  return p_id;
exception when unique_violation then
  raise exception 'Nama bahan sudah dipakai';
end $$;

-- What a change would do to the products that use the ingredient. Writes nothing.
create or replace function public.owner_preview_ingredient(p_id uuid, p_price numeric, p_pack_qty numeric, p_pack_unit text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cur public.ingredients%rowtype; ov jsonb;
begin
  select * into cur from public.ingredients where id = p_id;
  if not found then raise exception 'Bahan tidak ditemukan'; end if;
  perform public.assert_catalog_access(cur.outlet_id);
  perform public.ingredient_check_pack(p_price, p_pack_qty, p_pack_unit);
  perform public.ingredient_check_family(p_id, cur.pack_unit, p_pack_unit);
  ov := jsonb_build_object('id', p_id, 'price', public.ingredient_running_price(cur, p_price, p_pack_qty, p_pack_unit),
                           'packQty', p_pack_qty, 'packUnit', p_pack_unit);
  return coalesce((
    select jsonb_agg(jsonb_build_object('productId', pr.id, 'name', pr.name, 'oldHpp', pr.hpp,
      'newHpp', (public.recipe_cost(pr.outlet_id, l.lines, ov) ->> 'hpp')::numeric) order by pr.name)
    from public.products pr
    cross join lateral (select jsonb_agg(jsonb_build_object('ingredientId', r.ingredient_id, 'qty', r.qty, 'unit', r.unit)) as lines
                        from public.recipe_lines r where r.product_id = pr.id) l
    where pr.hpp_source = 'recipe' and exists (select 1 from public.recipe_lines r where r.product_id = pr.id and r.ingredient_id = p_id)),
    '[]'::jsonb);
end $$;

revoke all on function public.owner_list_ingredients(uuid) from public, anon;
revoke all on function public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text, text) from public, anon;
revoke all on function public.owner_preview_ingredient(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.owner_list_ingredients(uuid) to authenticated;
grant execute on function public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.owner_preview_ingredient(uuid, numeric, numeric, text) to authenticated;

-- ================================================================ sales consume ingredients (Task 2)
-- A paid bill takes its recipe ingredients out of stock, only for ingredients whose stock runs. Nothing ever comes
-- back: not on void, refund, or a correction that lowers a quantity. A correction consumes only what it adds.
create index if not exists ingredient_moves_doc on public.ingredient_moves(doc_id) where kind = 'sale';

-- p_items: [{"productId", "qty"}].
create or replace function public.consume_ingredients(p_transaction uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  ids uuid[];
  x record;
begin
  create temporary table if not exists pg_temp.tmp_088_use (ingredient_id uuid, used numeric) on commit drop;
  truncate pg_temp.tmp_088_use;
  insert into pg_temp.tmp_088_use
  select r.ingredient_id, sum(it.qty * r.qty * public.unit_factor(r.unit))
  from (select (e ->> 'productId')::uuid as pid, (e ->> 'qty')::numeric as qty from jsonb_array_elements(p_items) e) it
  join public.products p on p.id = it.pid and p.hpp_source = 'recipe'
  join public.recipe_lines r on r.product_id = p.id
  where it.qty > 0
  group by r.ingredient_id;
  ids := array(select ingredient_id from pg_temp.tmp_088_use);
  perform 1 from public.ingredients where id = any(ids) order by id for update;
  for x in
    select u.ingredient_id, i.outlet_id, round(u.used, 3) as used
    from pg_temp.tmp_088_use u join public.ingredients i on i.id = u.ingredient_id
    where i.stock_started and u.used > 0 order by u.ingredient_id
  loop
    update public.ingredients set stock = stock - x.used where id = x.ingredient_id;
    insert into public.ingredient_moves(ingredient_id, outlet_id, kind, qty, doc_id, created_by)
    values (x.ingredient_id, x.outlet_id, 'sale', -x.used, p_transaction, auth.uid());
  end loop;
end $$;
revoke all on function public.consume_ingredients(uuid, jsonb) from public, anon, authenticated;

-- Deferred to commit so it sees the bill's final items on every payment path (new bill, held bill, split part).
-- Any error only skips the ingredients, with a warning; the sale stays.
create or replace function public.trg_consume_ingredients()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if current_setting('hermes.skip_ingredients', true) = '1' then return null; end if;
    if tg_op = 'UPDATE' and old.status = 'completed' then return null; end if;
    if exists (select 1 from public.ingredient_moves where kind = 'sale' and doc_id = new.id) then return null; end if;
    perform public.consume_ingredients(new.id, coalesce((
      select jsonb_agg(jsonb_build_object('productId', product_id, 'qty', quantity))
      from public.transaction_items where transaction_id = new.id), '[]'::jsonb));
  exception when others then
    raise warning 'Stok bahan tidak dikurangi untuk bill %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.trg_consume_ingredients() from public, anon, authenticated;

drop trigger if exists transactions_consume_ingredients on public.transactions;
create constraint trigger transactions_consume_ingredients
after insert or update of status on public.transactions
deferrable initially deferred
for each row when (new.status = 'completed')
execute function public.trg_consume_ingredients();

-- Same as 073, plus: the new bill skips the trigger and consumes only what it adds per product.

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
  -- The deferred trigger must not consume the whole new bill again.
  perform set_config('hermes.skip_ingredients', '1', true);

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
  perform public.consume_ingredients(v_new, coalesce((
    select jsonb_agg(jsonb_build_object('productId', n.product_id, 'qty', n.qty - coalesce(o.qty, 0)))
    from (select product_id, sum(quantity) as qty from public.transaction_items where transaction_id = v_new group by 1) n
    left join (select product_id, sum(quantity) as qty from public.transaction_items where transaction_id = t.id group by 1) o
      on o.product_id = n.product_id
    where n.qty > coalesce(o.qty, 0)), '[]'::jsonb));

  select coalesce(sum(quantity * selling_price_unit), 0), coalesce(sum(discount_amount), 0), coalesce(sum(quantity * hpp_unit), 0)
    into v_gross, v_idisc, v_hpp
  from public.transaction_items where transaction_id = v_new;
  v_total := public.set_bill_totals(v_new, v_gross, v_idisc, t.bill_discount_type, t.bill_discount_value);
  update public.transactions
  -- completed_at is when its stock left (now); created_at keeps the sale on the original's day.
  set total_hpp = v_hpp, payment_method = p_payment_method, status = 'completed', completed_at = now()
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

-- ================================================================ count ingredient stock (Task 3)
-- p_lines: [{"ingredientId", "qty", "unit"}]. The count replaces the stock. An ingredient that is not running yet starts
-- here ('opening': no loss); otherwise the difference is the loss or gain ('count', valued at the average). The price
-- never changes, and nothing is posted to the ledger (release B2).
create or replace function public.owner_count_ingredients(p_outlet_id uuid, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.assert_outlet_owner(p_outlet_id);
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_doc uuid := gen_random_uuid();
  ids uuid[];
  x record;
  v_after numeric;
  v_diff numeric;
  v_kind text;
  v_value numeric;
  v_out jsonb := '[]'::jsonb;
begin
  if not public.subscription_active(b) then perform public.raise_expired('menghitung stok'); end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Isi minimal satu bahan'; end if;
  if jsonb_array_length(p_lines) > 200 then raise exception 'Hitung stok maksimal 200 bahan'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e where jsonb_typeof(e) <> 'object' or coalesce(e ->> 'ingredientId', '') !~* uuid_re) then
    raise exception 'Data hitung stok tidak valid';
  end if;
  -- At most 9 whole digits keeps the count under 1.000.000.000.
  if exists (select 1 from jsonb_array_elements(p_lines) e where coalesce(e ->> 'qty', '') !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$') then
    raise exception 'Jumlah hitung harus 0 atau lebih, sampai 3 desimal, di bawah 1.000.000.000';
  end if;
  if (select count(*) <> count(distinct lower(e ->> 'ingredientId')) from jsonb_array_elements(p_lines) e) then
    raise exception 'Satu bahan hanya boleh sekali per hitung stok';
  end if;
  ids := array(select distinct (e ->> 'ingredientId')::uuid from jsonb_array_elements(p_lines) e);

  perform 1 from public.ingredients where id = any(ids) and outlet_id = p_outlet_id order by id for update;
  if (select count(*) from public.ingredients where id = any(ids) and outlet_id = p_outlet_id) <> cardinality(ids) then
    raise exception 'Bahan tidak ditemukan di outlet ini';
  end if;

  for x in
    select i.*, e ->> 'unit' as unit, (e ->> 'qty')::numeric as qty, i.pack_qty * public.unit_factor(i.pack_unit) as per_pack
    from jsonb_array_elements(p_lines) e join public.ingredients i on i.id = (e ->> 'ingredientId')::uuid
    order by i.id
  loop
    if public.unit_family(x.unit) <> public.unit_family(x.pack_unit) then
      raise exception 'Satuan % harus sejenis dengan satuan kemasan %', x.name, x.pack_unit;
    end if;
    v_after := round(x.qty * public.unit_factor(x.unit), 3);
    if x.stock_started then
      v_kind := 'count'; v_diff := v_after - x.stock; v_value := round(v_diff * x.price / x.per_pack, 2);
    else
      v_kind := 'opening'; v_diff := v_after; v_value := 0;
    end if;
    update public.ingredients set stock = v_after, stock_started = true, updated_at = now() where id = x.id;
    insert into public.ingredient_moves(ingredient_id, outlet_id, kind, qty, counted, doc_id, created_by)
    values (x.id, p_outlet_id, v_kind, v_diff, v_after, v_doc, auth.uid());
    v_out := v_out || jsonb_build_object('ingredientId', x.id, 'name', x.name, 'kind', v_kind, 'before', x.stock,
      'after', v_after, 'diff', v_diff, 'value', v_value);
  end loop;
  return jsonb_build_object('lines', v_out);
end $$;
revoke all on function public.owner_count_ingredients(uuid, jsonb) from public, anon;
grant execute on function public.owner_count_ingredients(uuid, jsonb) to authenticated;
