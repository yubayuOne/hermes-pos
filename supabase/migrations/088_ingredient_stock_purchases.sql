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
  for x in select * from public.purchase_lines where purchase_id = p.id order by ingredient_id loop
    update public.ingredients set stock = stock - x.base_qty, price = x.price_before, updated_at = now() where id = x.ingredient_id;
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
