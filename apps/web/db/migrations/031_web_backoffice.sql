-- 031_web_backoffice.sql
-- Database support for the web backoffice designed in DESIGN.md v2.0 and PRD v2.1:
--   1. profiles: username (sign in with email or username), full name, WhatsApp   (A1, A2, A10)
--   2. business settings: type, city, time zone, receipt content, notification switches   (F12, D6, G2)
--   3. vouchers with optional product scope   (C5, F11)
--   4. manual bank transfer checkout: payment confirmations, invoices, admin verify/reject   (G8, G9)
--
-- Copy this file to supabase/migrations/ in the POS repo, after 030.
--
-- Depends on objects from migrations 026 to 030 (names as used by the backoffice):
--   public.businesses(id, name), public.outlets(id, business_id), public.products(id, outlet_id, name, is_active, is_temporary)
--   public.subscriptions(business_id, plan_code, expires_at, extra_outlets)
--   public.require_owner_business() returns uuid   -- raises when the caller owns no business
--   public.my_business_id() returns uuid           -- null when the caller owns no business (RLS)
--   public.admin_activate_subscription(p_business_id uuid, p_plan_code text, p_extra_outlets int)
-- Plan codes: 'monthly', 'semiannual', 'annual'. If 030 uses other names, change plan_terms() only.
--
-- Rules: every write goes through a security definer RPC; writes are refused when the subscription has
-- expired except paying (submit payment) and reading; nothing is ever deleted because of expiry.

begin;

-- ---------------------------------------------------------------- helpers
create or replace function public._031_active(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subscriptions s where s.business_id = p_business and s.expires_at > now());
$$;

create or replace function public._031_owner_writable()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_business uuid := public.require_owner_business();
begin
  if not public._031_active(v_business) then
    raise exception 'Langganan berakhir. Perpanjang paket untuk mengubah data.' using errcode = 'P0001';
  end if;
  return v_business;
end $$;

revoke all on function public._031_active(uuid) from public, anon, authenticated;
revoke all on function public._031_owner_writable() from public, anon, authenticated;

-- ---------------------------------------------------------------- 1. profiles
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  full_name text not null default '' check (char_length(full_name) <= 80),
  whatsapp text not null default '' check (char_length(whatsapp) <= 20),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated using (user_id = auth.uid());

-- Sign-up form checks the username while typing. Returns only true/false, never who owns it.
create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(trim(p_username)) ~ '^[a-z0-9_.]{3,20}$'
     and not exists (select 1 from public.profiles where username = lower(trim(p_username)));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

create or replace function public.get_my_profile()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'username', p.username, 'full_name', p.full_name, 'whatsapp', p.whatsapp,
    'email', (select u.email from auth.users u where u.id = auth.uid()))
  from public.profiles p where p.user_id = auth.uid();
$$;
grant execute on function public.get_my_profile() to authenticated;

-- Creates or updates the caller's profile. Allowed while expired: it is account data, not business data.
create or replace function public.save_my_profile(p_full_name text, p_username text, p_whatsapp text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_username text := lower(trim(coalesce(p_username, '')));
begin
  if v_user is null then raise exception 'Sesi berakhir. Silakan masuk lagi.' using errcode = '28000'; end if;
  if v_username !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'Username 3 sampai 20 karakter: huruf kecil, angka, titik, atau garis bawah.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_full_name, ''))) > 80 then raise exception 'Nama lengkap maksimal 80 karakter.' using errcode = '22023'; end if;
  if coalesce(p_whatsapp, '') !~ '^[0-9+ ]{0,20}$' then raise exception 'Nomor WhatsApp hanya angka, spasi, atau +.' using errcode = '22023'; end if;
  if exists (select 1 from public.profiles where username = v_username and user_id <> v_user) then
    raise exception 'Username sudah dipakai. Pilih username lain.' using errcode = '23505';
  end if;
  insert into public.profiles(user_id, username, full_name, whatsapp)
  values (v_user, v_username, trim(coalesce(p_full_name, '')), trim(coalesce(p_whatsapp, '')))
  on conflict (user_id) do update set username = excluded.username, full_name = excluded.full_name,
    whatsapp = excluded.whatsapp, updated_at = now();
  return public.get_my_profile();
end $$;
grant execute on function public.save_my_profile(text, text, text) to authenticated;

-- Username sign-in: the backoffice server (service role only) turns a username into the email for Supabase Auth.
create or replace function public.resolve_login_email(p_identifier text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text := lower(trim(coalesce(p_identifier, ''))); v_email text;
begin
  if position('@' in v) > 0 then return v; end if;
  select u.email into v_email from public.profiles p join auth.users u on u.id = p.user_id where p.username = v;
  return v_email;
end $$;
revoke all on function public.resolve_login_email(text) from public, anon, authenticated;
grant execute on function public.resolve_login_email(text) to service_role;

-- ---------------------------------------------------------------- 2. business settings
alter table public.businesses
  add column if not exists business_type text not null default 'kafe',
  add column if not exists city text not null default '',
  add column if not exists timezone text not null default 'Asia/Jakarta',
  add column if not exists receipt jsonb not null default jsonb_build_object(
    'header', '', 'footer', 'Terima kasih', 'show_logo', true, 'show_header', true, 'show_address', true,
    'show_phone', true, 'show_cashier', true, 'show_notes', true, 'show_tax', true, 'show_footer', true),
  add column if not exists notify jsonb not null default jsonb_build_object(
    'subscription', true, 'cash_variance', true, 'low_stock', true);

do $$ begin
  alter table public.businesses add constraint businesses_type_chk check (business_type in ('kafe','restoran','kedai','bakeri','lainnya'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.businesses add constraint businesses_tz_chk check (timezone in ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura'));
exception when duplicate_object then null; end $$;

create or replace function public.owner_get_business()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'name', b.name, 'business_type', b.business_type, 'city', b.city,
    'timezone', b.timezone, 'receipt', b.receipt, 'notify', b.notify)
  from public.businesses b where b.id = public.require_owner_business();
$$;
grant execute on function public.owner_get_business() to authenticated;

create or replace function public.owner_update_business(p_name text, p_business_type text, p_city text, p_timezone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_business uuid := public._031_owner_writable();
begin
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'Nama bisnis wajib diisi, maksimal 60 karakter.' using errcode = '22023'; end if;
  if p_business_type not in ('kafe','restoran','kedai','bakeri','lainnya') then raise exception 'Pilih jenis usaha.' using errcode = '22023'; end if;
  if p_timezone not in ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura') then raise exception 'Pilih zona waktu WIB, WITA, atau WIT.' using errcode = '22023'; end if;
  if char_length(coalesce(p_city, '')) > 60 then raise exception 'Nama kota maksimal 60 karakter.' using errcode = '22023'; end if;
  update public.businesses set name = trim(p_name), business_type = p_business_type, city = trim(coalesce(p_city, '')), timezone = p_timezone
  where id = v_business;
  return public.owner_get_business();
end $$;
grant execute on function public.owner_update_business(text, text, text, text) to authenticated;

-- Receipt content. Only known keys are kept; texts are at most 120 characters.
create or replace function public.owner_update_receipt(p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_business uuid := public._031_owner_writable(); v_out jsonb; k text;
begin
  select receipt into v_out from public.businesses where id = v_business;
  foreach k in array array['header','footer'] loop
    if p_receipt ? k then
      if jsonb_typeof(p_receipt -> k) <> 'string' or char_length(p_receipt ->> k) > 120 then
        raise exception 'Teks struk maksimal 120 karakter.' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(k, p_receipt ->> k);
    end if;
  end loop;
  foreach k in array array['show_logo','show_header','show_address','show_phone','show_cashier','show_notes','show_tax','show_footer'] loop
    if p_receipt ? k then
      if jsonb_typeof(p_receipt -> k) <> 'boolean' then raise exception 'Pengaturan struk tidak valid.' using errcode = '22023'; end if;
      v_out := v_out || jsonb_build_object(k, (p_receipt ->> k)::boolean);
    end if;
  end loop;
  update public.businesses set receipt = v_out where id = v_business;
  return v_out;
end $$;
grant execute on function public.owner_update_receipt(jsonb) to authenticated;

-- Notification switches. Allowed while expired so the owner can still choose to get renewal reminders.
create or replace function public.owner_update_notify(p_notify jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_business uuid := public.require_owner_business(); v_out jsonb; k text;
begin
  select notify into v_out from public.businesses where id = v_business;
  foreach k in array array['subscription','cash_variance','low_stock'] loop
    if p_notify ? k then
      if jsonb_typeof(p_notify -> k) <> 'boolean' then raise exception 'Pengaturan notifikasi tidak valid.' using errcode = '22023'; end if;
      v_out := v_out || jsonb_build_object(k, (p_notify ->> k)::boolean);
    end if;
  end loop;
  update public.businesses set notify = v_out where id = v_business;
  return v_out;
end $$;
grant execute on function public.owner_update_notify(jsonb) to authenticated;

-- ---------------------------------------------------------------- 2b. product on/off switch
-- The Products table has an Active switch (F4). Switching off keeps the product for reports; switching on
-- counts against the per-outlet product limit (PRD section 6 rule 3): 40 during trial, 100 on paid plans.
create or replace function public.owner_set_product_active(p_product_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_business uuid := public._031_owner_writable();
  v_outlet uuid;
  v_limit int;
begin
  select p.outlet_id into v_outlet from public.products p join public.outlets o on o.id = p.outlet_id
  where p.id = p_product_id and o.business_id = v_business and not p.is_temporary for update of p;
  if v_outlet is null then raise exception 'Produk tidak ditemukan.' using errcode = 'P0002'; end if;
  if p_active then
    select case when s.plan_code = 'trial' then 40 else 100 end into v_limit from public.subscriptions s where s.business_id = v_business;
    if (select count(*) from public.products where outlet_id = v_outlet and is_active and not is_temporary and id <> p_product_id) >= coalesce(v_limit, 40) then
      raise exception 'Batas % produk aktif per outlet tercapai. Matikan produk lain atau perpanjang paket.', coalesce(v_limit, 40) using errcode = 'P0001';
    end if;
  end if;
  update public.products set is_active = p_active where id = p_product_id;
end $$;
grant execute on function public.owner_set_product_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 3. vouchers
create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{4,12}$'),
  scope text not null default 'bill' check (scope in ('bill','products')),
  discount_type text not null check (discount_type in ('percent','amount')),
  value numeric(14,2) not null check (value > 0),
  min_spend numeric(14,2) not null default 0 check (min_spend >= 0),
  quota integer check (quota is null or quota > 0),
  used_count integer not null default 0 check (used_count >= 0),
  expires_on date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, code),
  check (discount_type <> 'percent' or value <= 100),
  check (discount_type <> 'amount' or value >= 1000)
);
create table if not exists public.voucher_products (
  voucher_id uuid not null references public.vouchers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (voucher_id, product_id)
);
alter table public.vouchers enable row level security;
alter table public.voucher_products enable row level security;
drop policy if exists vouchers_owner_read on public.vouchers;
create policy vouchers_owner_read on public.vouchers for select to authenticated using (business_id = public.my_business_id());
drop policy if exists voucher_products_owner_read on public.voucher_products;
create policy voucher_products_owner_read on public.voucher_products for select to authenticated
  using (exists (select 1 from public.vouchers v where v.id = voucher_id and v.business_id = public.my_business_id()));

-- Status shown in the table. Date is compared in the business time zone.
create or replace function public.voucher_status(v public.vouchers, p_today date)
returns text language sql immutable as $$
  select case
    when not v.is_active then 'inactive'
    when v.expires_on < p_today then 'expired'
    when v.quota is not null and v.used_count >= v.quota then 'used_up'
    else 'active' end;
$$;

create or replace function public.owner_list_vouchers()
returns jsonb language sql stable security definer set search_path = public as $$
  with b as (
    select id, (now() at time zone timezone)::date as today from public.businesses where id = public.require_owner_business()
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'code', v.code, 'scope', v.scope, 'discount_type', v.discount_type, 'value', v.value,
      'min_spend', v.min_spend, 'quota', v.quota, 'used_count', v.used_count, 'expires_on', v.expires_on,
      'is_active', v.is_active, 'status', public.voucher_status(v, b.today),
      'product_ids', coalesce((select jsonb_agg(vp.product_id) from public.voucher_products vp where vp.voucher_id = v.id), '[]'::jsonb))
    order by v.created_at desc), '[]'::jsonb)
  from public.vouchers v join b on b.id = v.business_id;
$$;
grant execute on function public.owner_list_vouchers() to authenticated;

create or replace function public.owner_save_voucher(
  p_id uuid, p_code text, p_scope text, p_discount_type text, p_value numeric, p_min_spend numeric,
  p_quota integer, p_expires_on date, p_product_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_business uuid := public._031_owner_writable();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_today date;
  v_id uuid;
  v_ids uuid[] := coalesce(p_product_ids, '{}');
begin
  select (now() at time zone timezone)::date into v_today from public.businesses where id = v_business;
  if v_code !~ '^[A-Z0-9]{4,12}$' then raise exception 'Kode voucher 4 sampai 12 huruf atau angka, tanpa spasi.' using errcode = '22023'; end if;
  if p_scope not in ('bill','products') then raise exception 'Pilih berlaku untuk seluruh bill atau produk tertentu.' using errcode = '22023'; end if;
  if p_discount_type = 'percent' and (p_value is null or p_value < 1 or p_value > 100) then raise exception 'Potongan persen harus 1 sampai 100.' using errcode = '22023'; end if;
  if p_discount_type = 'amount' and (p_value is null or p_value < 1000) then raise exception 'Potongan nominal minimal Rp1.000.' using errcode = '22023'; end if;
  if p_discount_type not in ('percent','amount') then raise exception 'Pilih jenis potongan.' using errcode = '22023'; end if;
  if coalesce(p_min_spend, 0) < 0 then raise exception 'Minimal belanja tidak boleh negatif.' using errcode = '22023'; end if;
  if p_quota is not null and p_quota < 1 then raise exception 'Kuota minimal 1, atau kosongkan untuk tanpa batas.' using errcode = '22023'; end if;
  if p_expires_on is null or p_expires_on < v_today then raise exception 'Tanggal berakhir tidak boleh sebelum hari ini.' using errcode = '22023'; end if;
  if p_scope = 'products' then
    if cardinality(v_ids) = 0 then raise exception 'Pilih minimal satu produk.' using errcode = '22023'; end if;
    if exists (select 1 from unnest(v_ids) pid where not exists (
        select 1 from public.products p join public.outlets o on o.id = p.outlet_id where p.id = pid and o.business_id = v_business)) then
      raise exception 'Produk tidak ditemukan.' using errcode = '22023';
    end if;
  end if;
  if exists (select 1 from public.vouchers where business_id = v_business and code = v_code and id is distinct from p_id) then
    raise exception 'Kode voucher sudah dipakai. Pakai kode lain.' using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.vouchers(business_id, code, scope, discount_type, value, min_spend, quota, expires_on)
    values (v_business, v_code, p_scope, p_discount_type, round(p_value, 2), round(coalesce(p_min_spend, 0)), p_quota, p_expires_on)
    returning id into v_id;
  else
    update public.vouchers set code = v_code, scope = p_scope, discount_type = p_discount_type, value = round(p_value, 2),
      min_spend = round(coalesce(p_min_spend, 0)), quota = p_quota, expires_on = p_expires_on
    where id = p_id and business_id = v_business returning id into v_id;
    if v_id is null then raise exception 'Voucher tidak ditemukan.' using errcode = 'P0002'; end if;
    delete from public.voucher_products where voucher_id = v_id;
  end if;
  if p_scope = 'products' then
    insert into public.voucher_products(voucher_id, product_id) select v_id, x from (select distinct unnest(v_ids) x) s;
  end if;
  return v_id;
end $$;
grant execute on function public.owner_save_voucher(uuid, text, text, text, numeric, numeric, integer, date, uuid[]) to authenticated;

create or replace function public.owner_set_voucher_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_business uuid := public._031_owner_writable();
begin
  update public.vouchers set is_active = p_active where id = p_id and business_id = v_business;
  if not found then raise exception 'Voucher tidak ditemukan.' using errcode = 'P0002'; end if;
end $$;
grant execute on function public.owner_set_voucher_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 4. manual checkout
-- Prices of paid plans and the extra outlet (PRD section 6). Extra outlet estimate: Rp99.000 x plan months.
create or replace function public.plan_terms(p_plan text, out price bigint, out months integer)
language sql immutable as $$
  select case p_plan when 'monthly' then 149000 when 'semiannual' then 699000 when 'annual' then 1399000 end::bigint,
         case p_plan when 'monthly' then 1 when 'semiannual' then 6 when 'annual' then 12 end;
$$;

create or replace function public.plan_quote(p_plan text, p_extra_outlets integer)
returns bigint language plpgsql immutable as $$
declare t record;
begin
  select * into t from public.plan_terms(p_plan);
  if t.price is null then raise exception 'Pilih paket Bulanan, 6 bulan, atau Tahunan.' using errcode = '22023'; end if;
  if coalesce(p_extra_outlets, 0) < 0 or p_extra_outlets > 50 then raise exception 'Jumlah outlet tambahan tidak valid.' using errcode = '22023'; end if;
  return t.price + coalesce(p_extra_outlets, 0) * 99000 * t.months;
end $$;
grant execute on function public.plan_quote(text, integer) to anon, authenticated;

create sequence if not exists public.invoice_seq;

create table if not exists public.payment_confirmations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_number text not null unique,
  plan_code text not null check (plan_code in ('monthly','semiannual','annual')),
  extra_outlets integer not null default 0 check (extra_outlets between 0 and 50),
  amount_due bigint not null check (amount_due > 0),
  amount_paid bigint not null check (amount_paid > 0),
  sender_name text not null check (char_length(sender_name) between 2 and 80),
  bank_name text not null check (char_length(bank_name) between 2 and 40),
  transfer_date date not null,
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'submitted' check (status in ('submitted','verified','rejected')),
  reject_reason text,
  new_expires_at timestamptz,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists payment_one_pending on public.payment_confirmations(business_id) where status = 'submitted';
alter table public.payment_confirmations enable row level security;
drop policy if exists payments_owner_read on public.payment_confirmations;
create policy payments_owner_read on public.payment_confirmations for select to authenticated using (business_id = public.my_business_id());

-- The owner confirms a transfer. Allowed while expired (that is how they renew). One pending at a time.
create or replace function public.owner_submit_payment(
  p_plan_code text, p_extra_outlets integer, p_sender_name text, p_bank_name text,
  p_transfer_date date, p_amount_paid bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_business uuid := public.require_owner_business();
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_due bigint := public.plan_quote(p_plan_code, coalesce(p_extra_outlets, 0));
  v_row public.payment_confirmations;
begin
  if char_length(trim(coalesce(p_sender_name, ''))) < 2 then raise exception 'Isi nama pengirim sesuai nama di rekening.' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_bank_name, ''))) < 2 then raise exception 'Isi nama bank asal transfer.' using errcode = '22023'; end if;
  if p_transfer_date is null or p_transfer_date > v_today then raise exception 'Tanggal transfer tidak boleh setelah hari ini.' using errcode = '22023'; end if;
  if p_transfer_date < v_today - 30 then raise exception 'Tanggal transfer paling lama 30 hari yang lalu.' using errcode = '22023'; end if;
  if coalesce(p_amount_paid, 0) <= 0 then raise exception 'Isi jumlah yang ditransfer.' using errcode = '22023'; end if;
  if exists (select 1 from public.payment_confirmations where business_id = v_business and status = 'submitted') then
    raise exception 'Masih ada konfirmasi pembayaran yang sedang diperiksa.' using errcode = '23505';
  end if;
  insert into public.payment_confirmations(business_id, invoice_number, plan_code, extra_outlets, amount_due, amount_paid,
    sender_name, bank_name, transfer_date, note)
  values (v_business, 'INV-' || to_char(v_today, 'YYYYMMDD') || '-' || lpad(nextval('public.invoice_seq')::text, 5, '0'),
    p_plan_code, coalesce(p_extra_outlets, 0), v_due, p_amount_paid, trim(p_sender_name), trim(p_bank_name),
    p_transfer_date, left(trim(coalesce(p_note, '')), 300))
  returning * into v_row;
  return to_jsonb(v_row) - 'business_id';
end $$;
grant execute on function public.owner_submit_payment(text, integer, text, text, date, bigint, text) to authenticated;

create or replace function public.owner_list_payments()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(p) - 'business_id' order by p.created_at desc), '[]'::jsonb)
  from public.payment_confirmations p where p.business_id = public.require_owner_business();
$$;
grant execute on function public.owner_list_payments() to authenticated;

-- Admin (service role or SQL Editor): verify activates the plan through admin_activate_subscription, which adds
-- to the remaining time while active and counts from today when expired.
create or replace function public.admin_verify_payment(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.payment_confirmations; v_expires timestamptz;
begin
  select * into v_row from public.payment_confirmations where id = p_id for update;
  if v_row.id is null then raise exception 'Konfirmasi pembayaran tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_row.status <> 'submitted' then raise exception 'Konfirmasi ini sudah diproses.' using errcode = '23505'; end if;
  perform public.admin_activate_subscription(v_row.business_id, v_row.plan_code, v_row.extra_outlets);
  select expires_at into v_expires from public.subscriptions where business_id = v_row.business_id;
  update public.payment_confirmations set status = 'verified', new_expires_at = v_expires, decided_at = now()
  where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public.admin_reject_payment(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.payment_confirmations;
begin
  update public.payment_confirmations set status = 'rejected', reject_reason = left(trim(coalesce(p_reason, '')), 200), decided_at = now()
  where id = p_id and status = 'submitted' returning * into v_row;
  if v_row.id is null then raise exception 'Konfirmasi tidak ditemukan atau sudah diproses.' using errcode = 'P0002'; end if;
  return to_jsonb(v_row);
end $$;

revoke all on function public.admin_verify_payment(uuid) from public, anon, authenticated;
revoke all on function public.admin_reject_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_verify_payment(uuid) to service_role;
grant execute on function public.admin_reject_payment(uuid, text) to service_role;

commit;
