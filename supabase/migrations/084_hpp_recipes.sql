-- HPP from a recipe (docs/superpowers/specs/2026-10-23-hpp-resep-design.md).
--
-- The owner lists ingredients (price per pack) and writes a recipe per product; the HPP of a product with a recipe is
-- computed here and stored in products.hpp, so the POS, transactions, stock value, and reports keep reading one column.
-- Past sales keep the hpp_unit they were sold with. All unit conversion and cost math lives in this file only.
--
-- Units: g, kg (mass), ml, l (volume), pcs (count). A recipe line must use the same family as the ingredient's pack.
-- The price per base unit is never rounded; only the finished HPP is rounded to numeric(14,2).

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  price numeric(14,2) not null check (price >= 0),
  pack_qty numeric(14,3) not null check (pack_qty > 0),
  pack_unit text not null check (pack_unit in ('g', 'kg', 'ml', 'l', 'pcs')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ingredients_outlet_name on public.ingredients(outlet_id, lower(btrim(name)));

create table if not exists public.recipe_lines (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  qty numeric(14,3) not null check (qty > 0),
  unit text not null check (unit in ('g', 'kg', 'ml', 'l', 'pcs')),
  unique (product_id, ingredient_id)
);
create index if not exists recipe_lines_ingredient on public.recipe_lines(ingredient_id);

alter table public.products add column if not exists hpp_source text not null default 'manual' check (hpp_source in ('manual', 'recipe'));

alter table public.ingredients enable row level security;
alter table public.recipe_lines enable row level security;
revoke all on public.ingredients from public, anon, authenticated;
revoke all on public.recipe_lines from public, anon, authenticated;

-- ---------------------------------------------------------------- units
create or replace function public.unit_family(u text)
returns text language plpgsql immutable as $$
declare f text := case u when 'g' then 'mass' when 'kg' then 'mass' when 'ml' then 'volume' when 'l' then 'volume' when 'pcs' then 'count' end;
begin
  if f is null then raise exception 'Satuan tidak valid'; end if;
  return f;
end $$;

-- How many base units (g, ml, pcs) one of u is.
create or replace function public.unit_factor(u text)
returns numeric language plpgsql immutable as $$
declare f numeric := case u when 'g' then 1 when 'kg' then 1000 when 'ml' then 1 when 'l' then 1000 when 'pcs' then 1 end;
begin
  if f is null then raise exception 'Satuan tidak valid'; end if;
  return f;
end $$;
revoke all on function public.unit_family(text) from public, anon, authenticated;
revoke all on function public.unit_factor(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- cost
-- p_lines: [{"ingredientId", "qty", "unit"}]. Returns {"lines": [{ingredientId, name, qty, unit, cost, incomplete}], "hpp", "incomplete"}.
-- A line is incomplete when its ingredient costs Rp 0 (the total is then an estimate). Line costs are rounded for display;
-- the total is rounded once from the unrounded sum.
-- p_override {"id", "price", "packQty", "packUnit"} prices one ingredient as if it had been saved (the repricing preview);
-- the caller keeps its unit in the same family.
create or replace function public.recipe_cost(p_outlet_id uuid, p_lines jsonb, p_override jsonb default null)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  bad text; v jsonb;
  ov_id uuid := (p_override ->> 'id')::uuid;
  ov_price numeric := (p_override ->> 'price')::numeric;
  ov_qty numeric := (p_override ->> 'packQty')::numeric;
  ov_unit text := p_override ->> 'packUnit';
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Data resep tidak valid'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
    where not exists (select 1 from public.ingredients i where i.id = (e ->> 'ingredientId')::uuid and i.outlet_id = p_outlet_id)
  ) then
    raise exception 'Bahan tidak ditemukan di outlet ini';
  end if;
  select i.name into bad
  from jsonb_array_elements(p_lines) e join public.ingredients i on i.id = (e ->> 'ingredientId')::uuid
  where public.unit_family(e ->> 'unit') <> public.unit_family(i.pack_unit)
  limit 1;
  if bad is not null then raise exception 'Satuan tidak cocok dengan bahan %', bad; end if;

  select jsonb_build_object(
    'lines', coalesce(jsonb_agg(jsonb_build_object('ingredientId', x.iid, 'name', x.name, 'qty', x.qty, 'unit', x.unit,
                                                   'cost', round(x.raw, 2), 'incomplete', x.price = 0) order by x.ord), '[]'::jsonb),
    'hpp', round(coalesce(sum(x.raw), 0), 2),
    'incomplete', coalesce(bool_or(x.price = 0), false))
  into v
  from (
    select t.ord, i.id as iid, i.name, pk.price, (t.e ->> 'qty')::numeric as qty, t.e ->> 'unit' as unit,
           (t.e ->> 'qty')::numeric * public.unit_factor(t.e ->> 'unit') * pk.price / (pk.pack_qty * public.unit_factor(pk.pack_unit)) as raw
    from jsonb_array_elements(p_lines) with ordinality t(e, ord)
    join public.ingredients i on i.id = (t.e ->> 'ingredientId')::uuid
    cross join lateral (select
      case when i.id = ov_id then ov_price else i.price end as price,
      case when i.id = ov_id then ov_qty else i.pack_qty end as pack_qty,
      case when i.id = ov_id then ov_unit else i.pack_unit end as pack_unit) pk
  ) x;
  return v;
end $$;
revoke all on function public.recipe_cost(uuid, jsonb, jsonb) from public, anon, authenticated;

-- A recipe product takes the cost of its stored lines; a manual product is left alone.
create or replace function public.recompute_hpp(p_product_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare pr public.products%rowtype; c jsonb;
begin
  select * into pr from public.products where id = p_product_id for update;
  if not found or pr.hpp_source <> 'recipe' then return; end if;
  c := public.recipe_cost(pr.outlet_id, coalesce(
    (select jsonb_agg(jsonb_build_object('ingredientId', ingredient_id, 'qty', qty, 'unit', unit)) from public.recipe_lines where product_id = p_product_id),
    '[]'::jsonb));
  update public.products set hpp = (c ->> 'hpp')::numeric where id = p_product_id;
end $$;
revoke all on function public.recompute_hpp(uuid) from public, anon, authenticated;

-- ================================================================ ingredient functions (owner of the outlet, as update_product)
-- Price, pack size, and unit rules shared by save and preview.
create or replace function public.ingredient_check_pack(p_price numeric, p_pack_qty numeric, p_pack_unit text)
returns void language plpgsql immutable as $$
begin
  if p_price is null or p_price < 0 then raise exception 'Harga tidak boleh negatif'; end if;
  if p_pack_qty is null or p_pack_qty <= 0 then raise exception 'Isi kemasan harus lebih dari 0'; end if;
  perform public.unit_family(p_pack_unit);
end $$;
revoke all on function public.ingredient_check_pack(numeric, numeric, text) from public, anon, authenticated;

-- A used ingredient keeps its unit family: a recipe line in g cannot follow a pack that became ml.
create or replace function public.ingredient_check_family(p_id uuid, p_old_unit text, p_new_unit text)
returns void language plpgsql stable as $$
begin
  if public.unit_family(p_old_unit) <> public.unit_family(p_new_unit) and exists (select 1 from public.recipe_lines where ingredient_id = p_id) then
    raise exception 'Satuan kemasan tidak bisa berganti jenis selama bahan dipakai resep';
  end if;
end $$;
revoke all on function public.ingredient_check_family(uuid, text, text) from public, anon, authenticated;

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
      'usedBy', (select count(*) from public.recipe_lines r where r.ingredient_id = i.id)) order by lower(i.name))
    from public.ingredients i where i.outlet_id = p_outlet_id), '[]'::jsonb);
end $$;

-- p_id null creates. A change recalculates every recipe product that uses the ingredient.
create or replace function public.owner_save_ingredient(p_outlet_id uuid, p_id uuid, p_name text, p_price numeric, p_pack_qty numeric, p_pack_unit text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  cur public.ingredients%rowtype;
  iid uuid;
  pid uuid;
begin
  perform public.assert_catalog_access(p_outlet_id);
  if v_name = '' then raise exception 'Nama bahan wajib diisi'; end if;
  if char_length(v_name) > 60 then raise exception 'Nama bahan maksimal 60 karakter'; end if;
  perform public.ingredient_check_pack(p_price, p_pack_qty, p_pack_unit);
  if p_id is null then
    insert into public.ingredients(outlet_id, name, price, pack_qty, pack_unit) values (p_outlet_id, v_name, p_price, p_pack_qty, p_pack_unit) returning id into iid;
    return iid;
  end if;
  select * into cur from public.ingredients where id = p_id and outlet_id = p_outlet_id for update;
  if not found then raise exception 'Bahan tidak ditemukan'; end if;
  perform public.ingredient_check_family(p_id, cur.pack_unit, p_pack_unit);
  update public.ingredients set name = v_name, price = p_price, pack_qty = p_pack_qty, pack_unit = p_pack_unit, updated_at = now() where id = p_id;
  -- Products in id order, the same lock order as everywhere else.
  for pid in select distinct product_id from public.recipe_lines where ingredient_id = p_id order by 1 loop
    perform public.recompute_hpp(pid);
  end loop;
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
  ov := jsonb_build_object('id', p_id, 'price', p_price, 'packQty', p_pack_qty, 'packUnit', p_pack_unit);
  return coalesce((
    select jsonb_agg(jsonb_build_object('productId', pr.id, 'name', pr.name, 'oldHpp', pr.hpp,
      'newHpp', (public.recipe_cost(pr.outlet_id, l.lines, ov) ->> 'hpp')::numeric) order by pr.name)
    from public.products pr
    cross join lateral (select jsonb_agg(jsonb_build_object('ingredientId', r.ingredient_id, 'qty', r.qty, 'unit', r.unit)) as lines
                        from public.recipe_lines r where r.product_id = pr.id) l
    where pr.hpp_source = 'recipe' and exists (select 1 from public.recipe_lines r where r.product_id = pr.id and r.ingredient_id = p_id)),
    '[]'::jsonb);
end $$;

create or replace function public.owner_delete_ingredient(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare cur public.ingredients%rowtype; used text;
begin
  select * into cur from public.ingredients where id = p_id for update;
  if not found then raise exception 'Bahan tidak ditemukan'; end if;
  perform public.assert_catalog_access(cur.outlet_id);
  select string_agg(distinct pr.name, ', ') into used
  from public.recipe_lines r join public.products pr on pr.id = r.product_id where r.ingredient_id = p_id;
  if used is not null then raise exception 'Dipakai di resep: %. Hapus dari resep itu dulu.', used; end if;
  delete from public.ingredients where id = p_id;
end $$;

revoke all on function public.owner_list_ingredients(uuid) from public, anon;
revoke all on function public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text) from public, anon;
revoke all on function public.owner_preview_ingredient(uuid, numeric, numeric, text) from public, anon;
revoke all on function public.owner_delete_ingredient(uuid) from public, anon;
grant execute on function public.owner_list_ingredients(uuid) to authenticated;
grant execute on function public.owner_save_ingredient(uuid, uuid, text, numeric, numeric, text) to authenticated;
grant execute on function public.owner_preview_ingredient(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.owner_delete_ingredient(uuid) to authenticated;

-- ================================================================ recipes and the product form
-- Replaces a product's recipe. [] removes it: the product turns manual and keeps its last HPP. Anything invalid
-- raises and the caller's transaction rolls back whole.
create or replace function public.apply_recipe(p_product_id uuid, p_lines jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  pr public.products%rowtype;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  qty_re constant text := '^[0-9]{1,6}(\.[0-9]{1,3})?$';
begin
  select * into pr from public.products where id = p_product_id for update;
  if not found then raise exception 'Produk tidak ditemukan'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Data resep tidak valid'; end if;
  if jsonb_array_length(p_lines) > 40 then raise exception 'Resep maksimal 40 bahan'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
             where jsonb_typeof(e) <> 'object' or coalesce(e ->> 'ingredientId', '') !~* uuid_re or coalesce(e ->> 'unit', '') not in ('g', 'kg', 'ml', 'l', 'pcs')) then
    raise exception 'Data resep tidak valid';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
             where case when coalesce(e ->> 'qty', '') ~ qty_re then (e ->> 'qty')::numeric <= 0 else true end) then
    raise exception 'Jumlah bahan tidak valid';
  end if;
  if (select count(*) <> count(distinct e ->> 'ingredientId') from jsonb_array_elements(p_lines) e) then
    raise exception 'Satu bahan hanya boleh sekali di resep';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    delete from public.recipe_lines where product_id = p_product_id;
    update public.products set hpp_source = 'manual' where id = p_product_id;
    return;
  end if;
  perform public.recipe_cost(pr.outlet_id, p_lines); -- ingredients of this outlet, units of the right family
  delete from public.recipe_lines where product_id = p_product_id;
  insert into public.recipe_lines(product_id, ingredient_id, qty, unit)
  select p_product_id, (e ->> 'ingredientId')::uuid, (e ->> 'qty')::numeric, e ->> 'unit' from jsonb_array_elements(p_lines) e;
  update public.products set hpp_source = 'recipe' where id = p_product_id;
  perform public.recompute_hpp(p_product_id);
end $$;
revoke all on function public.apply_recipe(uuid, jsonb) from public, anon, authenticated;

create or replace function public.owner_preview_recipe(p_outlet_id uuid, p_lines jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_catalog_access(p_outlet_id);
  return public.recipe_cost(p_outlet_id, p_lines);
end $$;

-- The stored recipe with its cost; a product without one returns source "manual" and no lines.
create or replace function public.owner_get_recipe(p_product_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pr public.products%rowtype;
begin
  select * into pr from public.products where id = p_product_id;
  if not found then raise exception 'Produk tidak ditemukan'; end if;
  perform public.assert_catalog_access(pr.outlet_id);
  return jsonb_build_object('source', pr.hpp_source) || public.recipe_cost(pr.outlet_id, coalesce((
    select jsonb_agg(jsonb_build_object('ingredientId', r.ingredient_id, 'qty', r.qty, 'unit', r.unit) order by lower(i.name))
    from public.recipe_lines r join public.ingredients i on i.id = r.ingredient_id where r.product_id = p_product_id), '[]'::jsonb));
end $$;

-- The product form's one save: create or update, and the recipe in the same transaction. p_recipe null leaves the recipe alone.
create or replace function public.owner_save_product(p_product_id uuid, p_outlet_id uuid, p_category_id uuid, p_name text, p_hpp numeric,
  p_selling_price numeric, p_stock numeric, p_station public.product_station, p_track_stock boolean, p_recipe jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  perform public.assert_catalog_access(p_outlet_id);
  if p_product_id is null then
    pid := public.create_product(p_outlet_id, p_category_id, p_name, p_hpp, p_selling_price, p_stock, p_station, p_track_stock);
  else
    pid := public.update_product(p_product_id, p_outlet_id, p_category_id, p_name, p_hpp, p_selling_price, p_stock, p_station, p_track_stock);
  end if;
  if p_recipe is not null and p_recipe <> 'null'::jsonb then perform public.apply_recipe(pid, p_recipe); end if;
  return pid;
end $$;

-- Same as 074 except the HPP: a product with a recipe keeps the HPP its recipe computed.
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
  set category_id = p_category_id, name = trim(p_name),
      hpp = case when cur.hpp_source = 'recipe' then cur.hpp else p_hpp end,
      selling_price = p_selling_price,
      stock = case when not p_track_stock then 0 when cur.track_stock then cur.stock else p_stock end,
      track_stock = p_track_stock, station = p_station
  where id = p_product_id
  returning id into pid;
  return pid;
end $$;

revoke all on function public.owner_preview_recipe(uuid, jsonb) from public, anon;
revoke all on function public.owner_get_recipe(uuid) from public, anon;
revoke all on function public.owner_save_product(uuid, uuid, uuid, text, numeric, numeric, numeric, public.product_station, boolean, jsonb) from public, anon;
grant execute on function public.owner_preview_recipe(uuid, jsonb) to authenticated;
grant execute on function public.owner_get_recipe(uuid) to authenticated;
grant execute on function public.owner_save_product(uuid, uuid, uuid, text, numeric, numeric, numeric, public.product_station, boolean, jsonb) to authenticated;
