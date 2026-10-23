-- The recipe is saved on its own page (Bahan & Resep), not inside the product form. [] removes it: the product turns
-- manual and keeps its last HPP. Same rules as the recipe part of owner_save_product (084).
create or replace function public.owner_save_recipe(p_product_id uuid, p_lines jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare pr public.products%rowtype;
begin
  select * into pr from public.products where id = p_product_id;
  if not found then raise exception 'Produk tidak ditemukan'; end if;
  perform public.assert_catalog_access(pr.outlet_id);
  perform public.apply_recipe(p_product_id, p_lines);
end $$;
revoke all on function public.owner_save_recipe(uuid, jsonb) from public, anon;
grant execute on function public.owner_save_recipe(uuid, jsonb) to authenticated;
