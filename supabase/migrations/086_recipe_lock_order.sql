-- Review follow-ups for 084.
--
-- 1. apply_recipe took the product lock and then waited on an ingredient (the foreign key check), while
--    owner_save_ingredient locks the ingredient and then the products: saving a recipe in one tab and repricing one of its
--    ingredients in another could deadlock. apply_recipe now locks the ingredients (by id) first, then the product, the
--    same order, so the two wait for each other instead.
-- 2. owner_delete_ingredient locked the row before the access check; it now locks only after access is proven.

create or replace function public.apply_recipe(p_product_id uuid, p_lines jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  pr public.products%rowtype;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  qty_re constant text := '^[0-9]{1,6}(\.[0-9]{1,3})?$';
begin
  select * into pr from public.products where id = p_product_id;
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

  -- Ingredients first (by id), then the product: the order owner_save_ingredient uses.
  perform 1 from public.ingredients
  where id in (select (e ->> 'ingredientId')::uuid from jsonb_array_elements(p_lines) e)
  order by id for key share;
  select * into pr from public.products where id = p_product_id for update;
  if not found then raise exception 'Produk tidak ditemukan'; end if;

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

create or replace function public.owner_delete_ingredient(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare cur public.ingredients%rowtype; used text;
begin
  select * into cur from public.ingredients where id = p_id;
  if not found then raise exception 'Bahan tidak ditemukan'; end if;
  perform public.assert_catalog_access(cur.outlet_id);
  select * into cur from public.ingredients where id = p_id for update;
  if not found then raise exception 'Bahan tidak ditemukan'; end if;
  select string_agg(distinct pr.name, ', ') into used
  from public.recipe_lines r join public.products pr on pr.id = r.product_id where r.ingredient_id = p_id;
  if used is not null then raise exception 'Dipakai di resep: %. Hapus dari resep itu dulu.', used; end if;
  delete from public.ingredients where id = p_id;
end $$;
