-- COLOONY 026: PIN kasir.
-- Satu akun perangkat (milik owner) dapat memegang banyak kasir. Setelah akun login di aplikasi POS,
-- kasir memilih namanya dan memasukkan PIN 6 angka yang dibuat owner. Kasir tidak punya akun login sendiri.
-- Tabel cashier_sessions tetap menjadi daftar kasir: satu baris = satu kasir pada satu outlet.

create extension if not exists pgcrypto;

-- Sebelumnya satu akun hanya boleh punya satu baris aktif. Sekarang boleh banyak, asal nama kasirnya berbeda.
drop index if exists public.cashier_sessions_active_user;
create unique index if not exists cashier_sessions_active_name
  on public.cashier_sessions(auth_user_id, lower(cashier_name)) where is_active;

alter table public.cashier_sessions
  add column if not exists pin_hash text,
  add column if not exists pin_failed_count integer not null default 0,
  add column if not exists pin_locked_until timestamptz;

-- Hash PIN tidak boleh terbaca dari klien. RLS bekerja per baris, jadi kolom dibatasi lewat hak akses kolom.
revoke select on public.cashier_sessions from anon, authenticated;
grant select (id, auth_user_id, cashier_id, outlet_id, cashier_name, outlet_name, terminal_name, is_active, created_at)
  on public.cashier_sessions to authenticated;

-- Daftar kasir aktif milik akun yang sedang login (tanpa hash PIN).
create or replace function public.list_device_cashiers()
returns table(
  cashier_id uuid, cashier_name text, outlet_id uuid, outlet_name text,
  outlet_phone text, outlet_logo_url text, terminal_name text, has_pin boolean
)
language sql stable security definer set search_path = public as $$
  select cs.cashier_id, cs.cashier_name, cs.outlet_id, coalesce(o.name, cs.outlet_name),
         o.phone, o.logo_url, cs.terminal_name, cs.pin_hash is not null
  from public.cashier_sessions cs
  left join public.outlets o on o.id = cs.outlet_id
  where cs.auth_user_id = auth.uid() and cs.is_active
  order by lower(cs.cashier_name);
$$;

-- Cek PIN. Hasilnya berupa jsonb (bukan exception) supaya hitungan salah tetap tersimpan.
-- 5 kali salah berturut-turut mengunci kasir itu selama 5 menit.
create or replace function public.verify_cashier_pin(p_cashier_id uuid, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.cashier_sessions%rowtype;
  failed integer;
begin
  select * into r from public.cashier_sessions
  where auth_user_id = auth.uid() and cashier_id = p_cashier_id and is_active
  for update;

  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.pin_hash is null then return jsonb_build_object('ok', false, 'reason', 'no_pin'); end if;

  if r.pin_locked_until is not null and r.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', r.pin_locked_until);
  end if;

  if r.pin_hash = crypt(coalesce(p_pin, ''), r.pin_hash) then
    update public.cashier_sessions set pin_failed_count = 0, pin_locked_until = null where id = r.id;
    return jsonb_build_object('ok', true);
  end if;

  failed := r.pin_failed_count + 1;
  if failed >= 5 then
    update public.cashier_sessions set pin_failed_count = 0, pin_locked_until = now() + interval '5 minutes' where id = r.id;
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', now() + interval '5 minutes');
  end if;
  update public.cashier_sessions set pin_failed_count = failed where id = r.id;
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'attempts_left', 5 - failed);
end $$;

-- Dipakai backoffice (service role) atau SQL Editor: membuat / mengganti PIN kasir.
create or replace function public.set_cashier_pin(p_cashier_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then raise exception 'PIN harus 6 angka'; end if;
  update public.cashier_sessions
  set pin_hash = crypt(p_pin, gen_salt('bf')), pin_failed_count = 0, pin_locked_until = null
  where cashier_id = p_cashier_id;
  if not found then raise exception 'Kasir tidak ditemukan'; end if;
end $$;

-- Mendaftarkan kasir baru pada akun perangkat (owner). Mengembalikan cashier_id.
create or replace function public.admin_create_cashier(
  p_auth_user_id uuid, p_outlet_id uuid, p_name text, p_pin text, p_terminal text default 'POS 1'
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  oname text;
  cid uuid;
begin
  if nullif(trim(p_name), '') is null then raise exception 'Nama kasir wajib diisi'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then raise exception 'PIN harus 6 angka'; end if;
  select name into oname from public.outlets where id = p_outlet_id;
  if oname is null then raise exception 'Outlet tidak ditemukan'; end if;
  if not exists (select 1 from auth.users where id = p_auth_user_id) then raise exception 'Akun tidak ditemukan'; end if;
  insert into public.cashier_sessions(auth_user_id, outlet_id, cashier_name, outlet_name, terminal_name, pin_hash)
  values (p_auth_user_id, p_outlet_id, trim(p_name), oname, coalesce(nullif(trim(p_terminal), ''), 'POS 1'), crypt(p_pin, gen_salt('bf')))
  returning cashier_id into cid;
  return cid;
end $$;

revoke all on function public.list_device_cashiers() from public, anon;
revoke all on function public.verify_cashier_pin(uuid, text) from public, anon;
revoke all on function public.set_cashier_pin(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_create_cashier(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.list_device_cashiers() to authenticated;
grant execute on function public.verify_cashier_pin(uuid, text) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_cashier_pin(uuid, text) to service_role;
    grant execute on function public.admin_create_cashier(uuid, uuid, text, text, text) to service_role;
  end if;
end $$;
