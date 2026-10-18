-- KASBOX Receipt + Production Station
-- Adds:
-- 1. Product station: kitchen | bar
-- 2. Outlet phone/logo for customer receipts
-- 3. CRUD RPC parameters for product station
--
-- Run after 001_initial.sql and 002_catalog_crud.sql.

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'product_station'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.product_station as enum ('kitchen', 'bar');
  end if;
end $$;

alter table public.products
  add column if not exists station public.product_station not null default 'kitchen';

alter table public.outlets
  add column if not exists phone text;

alter table public.outlets
  add column if not exists logo_url text;

create index if not exists products_outlet_station_active
  on public.products(outlet_id, station, is_active);

-- Avoid overloaded RPC ambiguity: replace the old product CRUD signatures.
drop function if exists public.create_product(uuid,uuid,text,numeric,numeric,numeric);
drop function if exists public.update_product(uuid,uuid,uuid,text,numeric,numeric,numeric);

create or replace function public.create_product(
  p_outlet_id uuid,
  p_category_id uuid,
  p_name text,
  p_hpp numeric,
  p_selling_price numeric,
  p_stock numeric default 0,
  p_station public.product_station default 'kitchen'
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
$$;

create or replace function public.update_product(
  p_product_id uuid,
  p_outlet_id uuid,
  p_category_id uuid,
  p_name text,
  p_hpp numeric,
  p_selling_price numeric,
  p_stock numeric,
  p_station public.product_station
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
$$;

grant execute on function public.create_product(uuid,uuid,text,numeric,numeric,numeric,public.product_station) to authenticated;
grant execute on function public.update_product(uuid,uuid,uuid,text,numeric,numeric,numeric,public.product_station) to authenticated;
