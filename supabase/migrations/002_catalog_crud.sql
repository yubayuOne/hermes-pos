-- KASBOX catalog CRUD
-- Enables authenticated active cashier sessions to manage catalog data
-- from the KASBOX Settings screen.
--
-- Deletes are intentionally soft deletes (is_active=false) so historical
-- transactions keep their product/category references.

create or replace function public.create_category(
  p_outlet_id uuid,
  p_name text,
  p_sort_order integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  perform public.assert_cashier(
    (select cashier_id from public.cashier_sessions
     where auth_user_id = auth.uid()
       and outlet_id = p_outlet_id
       and is_active
     limit 1),
    p_outlet_id
  );

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
$$;

create or replace function public.update_category(
  p_category_id uuid,
  p_outlet_id uuid,
  p_name text,
  p_sort_order integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
  cashier uuid;
begin
  select cs.cashier_id
  into cashier
  from public.cashier_sessions cs
  where cs.auth_user_id = auth.uid()
    and cs.outlet_id = p_outlet_id
    and cs.is_active
  limit 1;

  if cashier is null then
    raise exception 'Sesi kasir tidak valid';
  end if;

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
$$;

create or replace function public.delete_category(
  p_category_id uuid,
  p_outlet_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  perform public.assert_cashier(
    (select cashier_id from public.cashier_sessions
     where auth_user_id = auth.uid()
       and outlet_id = p_outlet_id
       and is_active
     limit 1),
    p_outlet_id
  );

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
$$;

create or replace function public.create_product(
  p_outlet_id uuid,
  p_category_id uuid,
  p_name text,
  p_hpp numeric,
  p_selling_price numeric,
  p_stock numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
  cashier uuid;
begin
  select cs.cashier_id
  into cashier
  from public.cashier_sessions cs
  where cs.auth_user_id = auth.uid()
    and cs.outlet_id = p_outlet_id
    and cs.is_active
  limit 1;

  if cashier is null then
    raise exception 'Sesi kasir tidak valid';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Nama produk wajib diisi';
  end if;

  if p_hpp < 0 or p_selling_price < 0 or p_stock < 0 then
    raise exception 'HPP, harga jual, dan stok tidak boleh negatif';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.categories
    where id = p_category_id
      and outlet_id = p_outlet_id
      and is_active = true
  ) then
    raise exception 'Kategori tidak ditemukan';
  end if;

  insert into public.products(
    outlet_id, category_id, name, hpp, selling_price, stock, is_active
  )
  values (
    p_outlet_id, p_category_id, trim(p_name), p_hpp, p_selling_price, p_stock, true
  )
  returning id into pid;

  return pid;
end;
$$;

create or replace function public.update_product(
  p_product_id uuid,
  p_outlet_id uuid,
  p_category_id uuid,
  p_name text,
  p_hpp numeric,
  p_selling_price numeric,
  p_stock numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
  cashier uuid;
begin
  select cs.cashier_id
  into cashier
  from public.cashier_sessions cs
  where cs.auth_user_id = auth.uid()
    and cs.outlet_id = p_outlet_id
    and cs.is_active
  limit 1;

  if cashier is null then
    raise exception 'Sesi kasir tidak valid';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Nama produk wajib diisi';
  end if;

  if p_hpp < 0 or p_selling_price < 0 or p_stock < 0 then
    raise exception 'HPP, harga jual, dan stok tidak boleh negatif';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.categories
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
      stock = p_stock
  where id = p_product_id
    and outlet_id = p_outlet_id
    and is_active = true
  returning id into pid;

  if pid is null then
    raise exception 'Produk tidak ditemukan';
  end if;

  return pid;
end;
$$;

create or replace function public.delete_product(
  p_product_id uuid,
  p_outlet_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  perform public.assert_cashier(
    (select cashier_id from public.cashier_sessions
     where auth_user_id = auth.uid()
       and outlet_id = p_outlet_id
       and is_active
     limit 1),
    p_outlet_id
  );

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
$$;

grant execute on function public.create_category(uuid,text,integer) to authenticated;
grant execute on function public.update_category(uuid,uuid,text,integer) to authenticated;
grant execute on function public.delete_category(uuid,uuid) to authenticated;
grant execute on function public.create_product(uuid,uuid,text,numeric,numeric,numeric) to authenticated;
grant execute on function public.update_product(uuid,uuid,uuid,text,numeric,numeric,numeric) to authenticated;
grant execute on function public.delete_product(uuid,uuid) to authenticated;
