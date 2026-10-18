-- COLOONY 027: fondasi Owner (bisnis) untuk website backoffice.
-- Satu owner = satu akun Supabase Auth = satu bisnis dengan banyak outlet. Kasir tetap tidak punya akun login:
-- kasir adalah baris cashier_sessions milik akun owner (lihat migrasi 026). Karena itu backoffice cukup memanggil
-- RPC di bawah dengan login owner; tidak perlu service role untuk mengelola kasir.

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner')),
  created_at timestamptz not null default now(),
  primary key (business_id, auth_user_id),
  unique (auth_user_id),      -- satu akun hanya memiliki satu bisnis
  unique (business_id)        -- satu bisnis hanya punya satu owner (dilonggarkan bila ada peran lain nanti)
);

alter table public.outlets add column if not exists business_id uuid references public.businesses(id) on delete cascade;
create index if not exists outlets_business_idx on public.outlets(business_id);

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;

-- Supabase memberi hak dasar otomatis; ditulis eksplisit agar jelas bahwa klien hanya boleh membaca (RLS membatasi barisnya).
grant select on public.businesses, public.business_members to authenticated;

-- Bisnis dibuat/diubah hanya lewat RPC. Klien hanya boleh membaca data miliknya.
drop policy if exists "member reads business" on public.businesses;
create policy "member reads business" on public.businesses for select using (
  exists (select 1 from public.business_members m where m.business_id = businesses.id and m.auth_user_id = auth.uid())
);
drop policy if exists "member reads self" on public.business_members;
create policy "member reads self" on public.business_members for select using (auth_user_id = auth.uid());
drop policy if exists "owner reads outlets" on public.outlets;
create policy "owner reads outlets" on public.outlets for select using (
  exists (select 1 from public.business_members m where m.business_id = outlets.business_id and m.auth_user_id = auth.uid())
);

-- Bisnis milik akun yang sedang login (null bila belum punya).
create or replace function public.my_business_id()
returns uuid language sql stable security definer set search_path = public as $$
  select business_id from public.business_members where auth_user_id = auth.uid() and role = 'owner'
$$;

create or replace function public.require_owner_business()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare b uuid;
begin
  if auth.uid() is null then raise exception 'Belum login'; end if;
  b := public.my_business_id();
  if b is null then raise exception 'Hanya owner yang boleh melakukan ini'; end if;
  return b;
end $$;

-- Pendaftaran owner baru: bisnis + outlet pertama dalam satu transaksi.
create or replace function public.register_business(p_business_name text, p_outlet_name text, p_outlet_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare bid uuid; oid uuid;
begin
  if auth.uid() is null then raise exception 'Belum login'; end if;
  if nullif(btrim(p_business_name), '') is null then raise exception 'Nama bisnis wajib diisi'; end if;
  if nullif(btrim(p_outlet_name), '') is null then raise exception 'Nama outlet wajib diisi'; end if;
  if exists (select 1 from public.business_members where auth_user_id = auth.uid()) then
    raise exception 'Akun ini sudah memiliki bisnis';
  end if;
  insert into public.businesses(name) values (btrim(p_business_name)) returning id into bid;
  insert into public.business_members(business_id, auth_user_id, role) values (bid, auth.uid(), 'owner');
  insert into public.outlets(business_id, name, phone) values (bid, btrim(p_outlet_name), nullif(btrim(coalesce(p_outlet_phone, '')), '')) returning id into oid;
  return jsonb_build_object('business_id', bid, 'outlet_id', oid);
end $$;

create or replace function public.owner_create_outlet(p_name text, p_address text default null, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); oid uuid;
begin
  if nullif(btrim(p_name), '') is null then raise exception 'Nama outlet wajib diisi'; end if;
  insert into public.outlets(business_id, name, address, phone)
  values (b, btrim(p_name), nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''))
  returning id into oid;
  return oid;
end $$;

create or replace function public.owner_update_outlet(p_outlet_id uuid, p_name text, p_address text default null, p_phone text default null, p_is_active boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.require_owner_business();
begin
  if nullif(btrim(p_name), '') is null then raise exception 'Nama outlet wajib diisi'; end if;
  update public.outlets
  set name = btrim(p_name), address = nullif(btrim(coalesce(p_address, '')), ''), phone = nullif(btrim(coalesce(p_phone, '')), ''), is_active = coalesce(p_is_active, true)
  where id = p_outlet_id and business_id = b;
  if not found then raise exception 'Outlet tidak ditemukan'; end if;
  -- Nama outlet disalin ke baris kasir (kolom outlet_name) agar tampilan POS ikut berubah.
  update public.cashier_sessions set outlet_name = btrim(p_name) where outlet_id = p_outlet_id;
end $$;

-- Daftar kasir seluruh outlet milik bisnis ini, termasuk yang nonaktif.
create or replace function public.owner_list_cashiers()
returns table(
  cashier_id uuid, cashier_name text, outlet_id uuid, outlet_name text, terminal_name text,
  is_active boolean, has_pin boolean, locked_until timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business();
begin
  return query
  select cs.cashier_id, cs.cashier_name, cs.outlet_id, o.name, cs.terminal_name, cs.is_active,
         cs.pin_hash is not null,
         case when cs.pin_locked_until > now() then cs.pin_locked_until end,
         cs.created_at
  from public.cashier_sessions cs
  join public.outlets o on o.id = cs.outlet_id
  where o.business_id = b and cs.auth_user_id = auth.uid()
  order by cs.is_active desc, lower(cs.cashier_name);
end $$;

create or replace function public.owner_create_cashier(p_outlet_id uuid, p_name text, p_pin text, p_terminal text default 'POS 1')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := public.require_owner_business(); oname text; cid uuid;
begin
  if nullif(btrim(p_name), '') is null then raise exception 'Nama kasir wajib diisi'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then raise exception 'PIN harus 6 angka'; end if;
  select name into oname from public.outlets where id = p_outlet_id and business_id = b and is_active;
  if oname is null then raise exception 'Outlet tidak ditemukan'; end if;
  begin
    insert into public.cashier_sessions(auth_user_id, outlet_id, cashier_name, outlet_name, terminal_name, pin_hash)
    values (auth.uid(), p_outlet_id, btrim(p_name), oname, coalesce(nullif(btrim(coalesce(p_terminal, '')), ''), 'POS 1'), crypt(p_pin, gen_salt('bf')))
    returning cashier_id into cid;
  exception when unique_violation then
    raise exception 'Nama kasir sudah dipakai';
  end;
  return cid;
end $$;

create or replace function public.owner_update_cashier(p_cashier_id uuid, p_name text, p_outlet_id uuid, p_terminal text default 'POS 1')
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); oname text;
begin
  if nullif(btrim(p_name), '') is null then raise exception 'Nama kasir wajib diisi'; end if;
  select name into oname from public.outlets where id = p_outlet_id and business_id = b;
  if oname is null then raise exception 'Outlet tidak ditemukan'; end if;
  begin
    update public.cashier_sessions
    set cashier_name = btrim(p_name), outlet_id = p_outlet_id, outlet_name = oname,
        terminal_name = coalesce(nullif(btrim(coalesce(p_terminal, '')), ''), 'POS 1')
    where cashier_id = p_cashier_id and auth_user_id = auth.uid()
      and outlet_id in (select id from public.outlets where business_id = b);
  exception when unique_violation then
    raise exception 'Nama kasir sudah dipakai';
  end;
  if not found then raise exception 'Kasir tidak ditemukan'; end if;
end $$;

create or replace function public.owner_set_cashier_pin(p_cashier_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := public.require_owner_business();
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then raise exception 'PIN harus 6 angka'; end if;
  update public.cashier_sessions
  set pin_hash = crypt(p_pin, gen_salt('bf')), pin_failed_count = 0, pin_locked_until = null
  where cashier_id = p_cashier_id and auth_user_id = auth.uid()
    and outlet_id in (select id from public.outlets where business_id = b);
  if not found then raise exception 'Kasir tidak ditemukan'; end if;
end $$;

create or replace function public.owner_set_cashier_active(p_cashier_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.require_owner_business();
begin
  update public.cashier_sessions set is_active = coalesce(p_active, true)
  where cashier_id = p_cashier_id and auth_user_id = auth.uid()
    and outlet_id in (select id from public.outlets where business_id = b);
  if not found then raise exception 'Kasir tidak ditemukan'; end if;
end $$;

-- Data lama: akun yang sudah punya kasir dijadikan owner satu bisnis; outlet yang dipakainya ditautkan.
-- Aman dijalankan ulang (akun yang sudah punya bisnis dilewati).
create or replace function public.backfill_businesses()
returns integer language plpgsql security definer set search_path = public as $$
declare u record; bid uuid; n integer := 0;
begin
  for u in
    select cs.auth_user_id, min(cs.outlet_name) as nm
    from public.cashier_sessions cs
    where not exists (select 1 from public.business_members m where m.auth_user_id = cs.auth_user_id)
    group by cs.auth_user_id
  loop
    insert into public.businesses(name) values (u.nm) returning id into bid;
    insert into public.business_members(business_id, auth_user_id, role) values (bid, u.auth_user_id, 'owner');
    update public.outlets o set business_id = bid
    where o.business_id is null
      and o.id in (select outlet_id from public.cashier_sessions where auth_user_id = u.auth_user_id);
    n := n + 1;
  end loop;
  return n;
end $$;
select public.backfill_businesses();

-- Hak akses: fungsi owner hanya untuk pengguna login. backfill_businesses internal (tidak untuk klien).
revoke all on function public.my_business_id() from public, anon;
revoke all on function public.require_owner_business() from public, anon, authenticated;
revoke all on function public.register_business(text, text, text) from public, anon;
revoke all on function public.owner_create_outlet(text, text, text) from public, anon;
revoke all on function public.owner_update_outlet(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.owner_list_cashiers() from public, anon;
revoke all on function public.owner_create_cashier(uuid, text, text, text) from public, anon;
revoke all on function public.owner_update_cashier(uuid, text, uuid, text) from public, anon;
revoke all on function public.owner_set_cashier_pin(uuid, text) from public, anon;
revoke all on function public.owner_set_cashier_active(uuid, boolean) from public, anon;
revoke all on function public.backfill_businesses() from public, anon, authenticated;
grant execute on function public.my_business_id() to authenticated;
grant execute on function public.register_business(text, text, text) to authenticated;
grant execute on function public.owner_create_outlet(text, text, text) to authenticated;
grant execute on function public.owner_update_outlet(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.owner_list_cashiers() to authenticated;
grant execute on function public.owner_create_cashier(uuid, text, text, text) to authenticated;
grant execute on function public.owner_update_cashier(uuid, text, uuid, text) to authenticated;
grant execute on function public.owner_set_cashier_pin(uuid, text) to authenticated;
grant execute on function public.owner_set_cashier_active(uuid, boolean) to authenticated;
