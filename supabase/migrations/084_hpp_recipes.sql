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
create or replace function public.recipe_cost(p_outlet_id uuid, p_lines jsonb)
returns jsonb
language plpgsql stable set search_path = public as $$
declare bad text; v jsonb;
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
    select t.ord, i.id as iid, i.name, i.price, (t.e ->> 'qty')::numeric as qty, t.e ->> 'unit' as unit,
           (t.e ->> 'qty')::numeric * public.unit_factor(t.e ->> 'unit') * i.price / (i.pack_qty * public.unit_factor(i.pack_unit)) as raw
    from jsonb_array_elements(p_lines) with ordinality t(e, ord)
    join public.ingredients i on i.id = (t.e ->> 'ingredientId')::uuid
  ) x;
  return v;
end $$;
revoke all on function public.recipe_cost(uuid, jsonb) from public, anon, authenticated;

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
