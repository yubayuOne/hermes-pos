-- COLOONY 030: langganan, batas paket, kunci saat berakhir, dan notifikasi pengingat (PRD bagian 6 dan modul G).
--
-- Satu bisnis = satu langganan dengan satu tanggal berakhir. Bisnis baru otomatis mendapat trial 3 hari.
-- Batas dan kunci dijaga oleh trigger pada tabel, jadi berlaku untuk semua RPC yang sudah ada (POS dan backoffice)
-- tanpa menulis ulang fungsinya:
--   outlets            : outlet aktif per bisnis <= 1 + outlet tambahan; outlet baru ditolak saat berakhir
--   cashier_sessions   : kasir aktif per outlet <= 2 (trial) atau 3; kasir baru ditolak saat berakhir
--   products           : produk aktif (bukan menu sementara) per outlet <= 40 (trial) atau 100; produk baru ditolak saat berakhir
--   categories         : kategori baru ditolak saat berakhir
--   shifts             : shift baru ditolak saat berakhir
--   transactions       : penjualan baru ditolak saat berakhir, kecuali shift-nya dibuka sebelum berakhir dan belum lewat
--                        24 jam sejak berakhir (antrean offline yang dibuat sebelum berakhir tetap bisa masuk)
-- Mengaktifkan kembali kasir, produk, atau outlet juga dihitung terhadap batas. Data tidak pernah dihapus.
-- Pesan galat diawali "Langganan berakhir" atau "Batas", dengan HINT 'subscription_expired' atau 'plan_limit'
-- supaya aplikasi bisa menampilkan layar terkunci.

-- ---------------------------------------------------------------- paket
create table if not exists public.plans (
  code text primary key,
  name text not null,
  price bigint not null check (price >= 0),
  duration_months integer not null default 0 check (duration_months >= 0),
  duration_days integer not null default 0 check (duration_days >= 0),
  cashiers_per_outlet integer not null check (cashiers_per_outlet > 0),
  products_per_outlet integer not null check (products_per_outlet > 0),
  is_trial boolean not null default false,
  sort_order integer not null default 0
);
insert into public.plans(code, name, price, duration_months, duration_days, cashiers_per_outlet, products_per_outlet, is_trial, sort_order) values
  ('trial', 'Trial', 0, 0, 3, 2, 40, true, 0),
  ('monthly', 'Bulanan', 149000, 1, 0, 3, 100, false, 1),
  ('semiannual', '6 bulan', 699000, 6, 0, 3, 100, false, 2),
  ('annual', 'Tahunan', 1399000, 12, 0, 3, 100, false, 3)
on conflict (code) do update set name = excluded.name, price = excluded.price, duration_months = excluded.duration_months,
  duration_days = excluded.duration_days, cashiers_per_outlet = excluded.cashiers_per_outlet,
  products_per_outlet = excluded.products_per_outlet, is_trial = excluded.is_trial, sort_order = excluded.sort_order;

-- Harga outlet tambahan per bulan.
create or replace function public.extra_outlet_price() returns bigint language sql immutable as $$ select 99000::bigint $$;

alter table public.plans enable row level security;
grant select on public.plans to anon, authenticated;
drop policy if exists "anyone reads plans" on public.plans;
create policy "anyone reads plans" on public.plans for select using (true);

-- ---------------------------------------------------------------- langganan
create table if not exists public.subscriptions (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  plan_code text not null references public.plans(code),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  extra_outlets integer not null default 0 check (extra_outlets between 0 and 50),
  trial_used boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
grant select on public.subscriptions to authenticated;
drop policy if exists "owner reads subscription" on public.subscriptions;
create policy "owner reads subscription" on public.subscriptions for select using (business_id = public.my_business_id());

-- Bisnis baru langsung mendapat trial 3 hari. Trial hanya sekali per bisnis (baris langganan tidak pernah dibuat ulang).
create or replace function public.trg_business_trial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions(business_id, plan_code, started_at, expires_at)
  values (new.id, 'trial', now(), now() + interval '3 days')
  on conflict (business_id) do nothing;
  return new;
end $$;
drop trigger if exists business_trial on public.businesses;
create trigger business_trial after insert on public.businesses for each row execute function public.trg_business_trial();

-- Bisnis yang sudah ada sebelum migrasi ini mendapat trial 3 hari mulai sekarang. Admin bisa langsung
-- mengaktifkan paket berbayar dengan admin_activate_subscription.
insert into public.subscriptions(business_id, plan_code, started_at, expires_at)
select b.id, 'trial', now(), now() + interval '3 days' from public.businesses b
on conflict (business_id) do nothing;

-- ---------------------------------------------------------------- pembacaan internal
create or replace function public.business_of_outlet(p_outlet_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select business_id from public.outlets where id = p_outlet_id
$$;

-- true bila langganan bisnis masih berlaku. Bisnis tanpa baris langganan dianggap berakhir.
create or replace function public.subscription_active(p_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.expires_at > now() from public.subscriptions s where s.business_id = p_business_id), false)
$$;

-- Batas paket bisnis: outlet aktif, kasir aktif per outlet, produk aktif per outlet.
create or replace function public.business_limits(p_business_id uuid, out max_outlets integer, out cashiers_per_outlet integer, out products_per_outlet integer)
language sql stable security definer set search_path = public as $$
  select case when p.is_trial then 1 else 1 + s.extra_outlets end, p.cashiers_per_outlet, p.products_per_outlet
  from public.subscriptions s join public.plans p on p.code = s.plan_code
  where s.business_id = p_business_id
$$;

create or replace function public.raise_expired(p_what text)
returns void language plpgsql as $$
begin
  raise exception 'Langganan berakhir. Perpanjang paket untuk %.', p_what using errcode = 'P0001', hint = 'subscription_expired';
end $$;

-- ---------------------------------------------------------------- trigger batas dan kunci
-- Outlet: baru atau diaktifkan kembali.
create or replace function public.trg_outlet_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim record; n integer;
begin
  if new.business_id is null or not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.is_active and old.business_id is not distinct from new.business_id then return new; end if;
  if not public.subscription_active(new.business_id) then perform public.raise_expired('menambah outlet'); end if;
  select * into lim from public.business_limits(new.business_id);
  select count(*) into n from public.outlets where business_id = new.business_id and is_active and id <> new.id;
  if n >= coalesce(lim.max_outlets, 1) then
    raise exception 'Batas % outlet aktif tercapai. Outlet tambahan diaktifkan setelah pembayaran.', coalesce(lim.max_outlets, 1)
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;
drop trigger if exists outlet_limits on public.outlets;
create trigger outlet_limits before insert or update of is_active, business_id on public.outlets
for each row execute function public.trg_outlet_limits();

-- Kasir: baru, diaktifkan kembali, atau dipindah ke outlet lain.
create or replace function public.trg_cashier_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare b uuid; lim record; n integer;
begin
  if not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.is_active and old.outlet_id = new.outlet_id then return new; end if;
  b := public.business_of_outlet(new.outlet_id);
  if b is null then return new; end if;
  if not public.subscription_active(b) then perform public.raise_expired('menambah atau mengaktifkan kasir'); end if;
  select * into lim from public.business_limits(b);
  select count(*) into n from public.cashier_sessions where outlet_id = new.outlet_id and is_active and id <> new.id;
  if n >= coalesce(lim.cashiers_per_outlet, 2) then
    raise exception 'Batas % kasir aktif per outlet tercapai. Nonaktifkan kasir lain atau perpanjang paket.', coalesce(lim.cashiers_per_outlet, 2)
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;
drop trigger if exists cashier_limits on public.cashier_sessions;
create trigger cashier_limits before insert or update of is_active, outlet_id on public.cashier_sessions
for each row execute function public.trg_cashier_limits();

-- Produk: baru atau diaktifkan kembali. Menu sementara (is_temporary) tidak dihitung dan tidak dikunci,
-- karena hanya dipakai di dalam penjualan, yang sudah dijaga trigger transaksi.
create or replace function public.trg_product_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare b uuid; lim record; n integer;
begin
  if new.is_temporary or not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.is_active and not old.is_temporary and old.outlet_id = new.outlet_id then return new; end if;
  b := public.business_of_outlet(new.outlet_id);
  if b is null then return new; end if;
  if not public.subscription_active(b) then perform public.raise_expired('menambah atau mengaktifkan produk'); end if;
  select * into lim from public.business_limits(b);
  select count(*) into n from public.products where outlet_id = new.outlet_id and is_active and not is_temporary and id <> new.id;
  if n >= coalesce(lim.products_per_outlet, 40) then
    raise exception 'Batas % produk aktif per outlet tercapai. Matikan produk lain atau perpanjang paket.', coalesce(lim.products_per_outlet, 40)
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;
drop trigger if exists product_limits on public.products;
create trigger product_limits before insert or update of is_active, is_temporary, outlet_id on public.products
for each row execute function public.trg_product_limits();

-- Kategori baru ditolak saat berakhir.
create or replace function public.trg_category_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare b uuid := public.business_of_outlet(new.outlet_id);
begin
  if b is not null and not public.subscription_active(b) then perform public.raise_expired('menambah kategori'); end if;
  return new;
end $$;
drop trigger if exists category_lock on public.categories;
create trigger category_lock before insert on public.categories for each row execute function public.trg_category_lock();

-- Shift baru ditolak saat berakhir.
create or replace function public.trg_shift_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare b uuid := public.business_of_outlet(new.outlet_id);
begin
  if b is not null and not public.subscription_active(b) then perform public.raise_expired('membuka shift'); end if;
  return new;
end $$;
drop trigger if exists shift_lock on public.shifts;
create trigger shift_lock before insert on public.shifts for each row execute function public.trg_shift_lock();

-- Penjualan: transaksi baru, atau bill yang diselesaikan. Saat berakhir, hanya lolos bila shift-nya dibuka sebelum
-- tanggal berakhir dan belum lewat 24 jam sejak berakhir. Server tidak bisa membedakan kiriman ulang antrean offline
-- dari penjualan baru; aplikasi kasir adalah lapisan utama yang menolak penjualan baru.
create or replace function public.trg_transaction_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare b uuid; v_expires timestamptz; v_opened timestamptz;
begin
  if tg_op = 'UPDATE' and not (new.status = 'completed' and old.status is distinct from 'completed') then return new; end if;
  b := public.business_of_outlet(new.outlet_id);
  if b is null then return new; end if;
  select expires_at into v_expires from public.subscriptions where business_id = b;
  if v_expires is not null and v_expires > now() then return new; end if;
  select opened_at into v_opened from public.shifts where id = new.shift_id;
  if v_expires is not null and v_opened is not null and v_opened < v_expires and now() < v_expires + interval '24 hours' then
    return new;
  end if;
  perform public.raise_expired('berjualan');
  return new;
end $$;
drop trigger if exists transaction_lock on public.transactions;
create trigger transaction_lock before insert or update of status on public.transactions
for each row execute function public.trg_transaction_lock();

-- ---------------------------------------------------------------- notifikasi
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null,
  params jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, dedupe_key)
);
create index if not exists notifications_business_created on public.notifications(business_id, created_at desc);
alter table public.notifications enable row level security;
-- Klien tidak membaca tabel ini langsung; semuanya lewat RPC di bawah.
revoke all on public.notifications from anon, authenticated;

-- Membuat pengingat yang jatuh tempo. Paket berbayar: 30, 21, 14, 7 hari sebelum berakhir. Trial: 2 dan 1 hari.
-- Hanya ambang terkecil yang sudah terlewati yang dibuat, satu kali per tanggal berakhir, jadi pengguna yang baru
-- membuka aplikasi 5 hari sebelum berakhir menerima satu pengingat (7 hari), bukan empat sekaligus.
-- Perpanjangan mengganti tanggal berakhir, sehingga jadwal mulai lagi. Teks dibentuk di aplikasi dari kind dan params.
create or replace function public.refresh_subscription_notifications(p_business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  days integer;
  thresholds integer[];
  t integer;
  pick integer;
  stamp text;
begin
  select sub.*, p.is_trial into s from public.subscriptions sub join public.plans p on p.code = sub.plan_code where sub.business_id = p_business_id;
  if not found then return; end if;
  stamp := to_char(s.expires_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD');
  if s.expires_at <= now() then
    insert into public.notifications(business_id, kind, params, dedupe_key)
    values (p_business_id, 'subscription_expired', jsonb_build_object('expires_at', s.expires_at, 'plan_code', s.plan_code), 'expired:' || stamp)
    on conflict (business_id, dedupe_key) do nothing;
    return;
  end if;
  days := (s.expires_at at time zone 'Asia/Jakarta')::date - (now() at time zone 'Asia/Jakarta')::date;
  thresholds := case when s.is_trial then array[2, 1] else array[30, 21, 14, 7] end;
  foreach t in array thresholds loop
    if days <= t then pick := t; end if;
  end loop;
  if pick is null then return; end if;
  insert into public.notifications(business_id, kind, params, dedupe_key)
  values (p_business_id, case when s.is_trial then 'trial_expiring' else 'subscription_expiring' end,
          jsonb_build_object('days_left', days, 'threshold', pick, 'expires_at', s.expires_at, 'plan_code', s.plan_code),
          'expiring:' || pick || ':' || stamp)
  on conflict (business_id, dedupe_key) do nothing;
end $$;

-- ---------------------------------------------------------------- RPC untuk aplikasi
-- Status langganan untuk sidebar, banner, layar terkunci, dan lonceng (G1). Juga membuat pengingat yang jatuh tempo.
-- Bisa dipanggil owner di backoffice maupun perangkat POS (keduanya memakai akun owner).
create or replace function public.get_subscription_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  s record;
  lim record;
  v_days integer;
begin
  perform public.refresh_subscription_notifications(b);
  select sub.*, p.name as plan_name, p.is_trial into s from public.subscriptions sub join public.plans p on p.code = sub.plan_code where sub.business_id = b;
  if not found then raise exception 'Langganan tidak ditemukan. Hubungi admin.'; end if;
  select * into lim from public.business_limits(b);
  v_days := greatest(0, (s.expires_at at time zone 'Asia/Jakarta')::date - (now() at time zone 'Asia/Jakarta')::date);
  return jsonb_build_object(
    'state', case when s.expires_at <= now() then 'expired' when s.is_trial then 'trial' else 'active' end,
    'plan_code', s.plan_code,
    'plan_name', s.plan_name,
    'started_at', s.started_at,
    'expires_at', s.expires_at,
    'days_left', case when s.expires_at <= now() then 0 else v_days end,
    'extra_outlets', s.extra_outlets,
    'limits', jsonb_build_object('outlets', lim.max_outlets, 'cashiers_per_outlet', lim.cashiers_per_outlet, 'products_per_outlet', lim.products_per_outlet),
    'usage', coalesce((
      select jsonb_agg(jsonb_build_object(
        'outlet_id', o.id, 'outlet_name', o.name,
        'active_cashiers', (select count(*) from public.cashier_sessions c where c.outlet_id = o.id and c.is_active),
        'active_products', (select count(*) from public.products p where p.outlet_id = o.id and p.is_active and not p.is_temporary)
      ) order by o.created_at)
      from public.outlets o where o.business_id = b and o.is_active
    ), '[]'::jsonb),
    'unread', (select count(*) from public.notifications n where n.business_id = b and n.read_at is null)
  );
end $$;

create or replace function public.list_notifications(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'params', n.params, 'read_at', n.read_at, 'created_at', n.created_at)
                     order by n.created_at desc)
    from (select * from public.notifications where business_id = b order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) n
  ), '[]'::jsonb);
end $$;

-- p_ids null menandai semua notifikasi sebagai sudah dibaca.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); n integer;
begin
  update public.notifications set read_at = now()
  where business_id = b and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- admin
-- Mengaktifkan atau memperpanjang paket setelah pembayaran (SQL Editor atau service role).
-- Masih berlaku (termasuk trial): ditambahkan ke sisa waktu. Sudah berakhir: dihitung dari sekarang.
create or replace function public.admin_activate_subscription(p_business_id uuid, p_plan_code text, p_extra_outlets integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.plans%rowtype; s public.subscriptions%rowtype; base timestamptz;
begin
  select * into p from public.plans where code = p_plan_code;
  if not found or p.is_trial then raise exception 'Paket tidak valid: pakai monthly, semiannual, atau annual'; end if;
  if coalesce(p_extra_outlets, 0) not between 0 and 50 then raise exception 'Jumlah outlet tambahan tidak valid'; end if;
  if not exists (select 1 from public.businesses where id = p_business_id) then raise exception 'Bisnis tidak ditemukan'; end if;
  select * into s from public.subscriptions where business_id = p_business_id for update;
  base := greatest(coalesce(s.expires_at, now()), now());
  insert into public.subscriptions(business_id, plan_code, started_at, expires_at, extra_outlets, updated_at)
  values (p_business_id, p.code, now(), base + make_interval(months => p.duration_months, days => p.duration_days), coalesce(p_extra_outlets, 0), now())
  on conflict (business_id) do update set plan_code = excluded.plan_code, started_at = excluded.started_at,
    expires_at = excluded.expires_at, extra_outlets = excluded.extra_outlets, updated_at = now()
  returning * into s;
  return to_jsonb(s);
end $$;

-- ---------------------------------------------------------------- hak akses
revoke all on function public.trg_business_trial() from public, anon, authenticated;
revoke all on function public.trg_outlet_limits() from public, anon, authenticated;
revoke all on function public.trg_cashier_limits() from public, anon, authenticated;
revoke all on function public.trg_product_limits() from public, anon, authenticated;
revoke all on function public.trg_category_lock() from public, anon, authenticated;
revoke all on function public.trg_shift_lock() from public, anon, authenticated;
revoke all on function public.trg_transaction_lock() from public, anon, authenticated;
revoke all on function public.business_of_outlet(uuid) from public, anon, authenticated;
revoke all on function public.subscription_active(uuid) from public, anon, authenticated;
revoke all on function public.business_limits(uuid) from public, anon, authenticated;
revoke all on function public.refresh_subscription_notifications(uuid) from public, anon, authenticated;
revoke all on function public.admin_activate_subscription(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.get_subscription_status() from public, anon;
revoke all on function public.list_notifications(integer) from public, anon;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.get_subscription_status() to authenticated;
grant execute on function public.list_notifications(integer) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.admin_activate_subscription(uuid, text, integer) to service_role;
  end if;
end $$;
