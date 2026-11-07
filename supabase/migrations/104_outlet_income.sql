-- 104: Kas: pemasukan dari luar (owner's request, 7 Nov 2026). It goes straight into the outlet's cash, not into a shift
-- or the drawer, so it never changes a shift's expected cash. Kas Outlet = sales + these rows; Sisa Kas = that - expenses.

create table if not exists public.outlet_income (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  outlet_id uuid not null references public.outlets(id),
  business_date date not null,
  amount numeric(14,2) not null check (amount > 0 and amount <= 1000000000 and amount = round(amount)),
  reason text not null check (char_length(reason) between 3 and 200),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists outlet_income_outlet_date on public.outlet_income(outlet_id, business_date);
alter table public.outlet_income enable row level security;
revoke all on public.outlet_income from public, anon, authenticated;

-- Checks shared by add and update: the amount, the reason, the date (not after today in the business time zone).
create or replace function public._outlet_income_check(p_business_date date, p_amount numeric, p_reason text, p_business_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_today date;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount) or p_amount > 1000000000 then
    raise exception 'Nominal harus angka bulat lebih dari 0, maksimal Rp1.000.000.000';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Alasan wajib diisi, minimal 3 karakter'; end if;
  if char_length(btrim(p_reason)) > 200 then raise exception 'Alasan maksimal 200 karakter'; end if;
  select (now() at time zone coalesce(b.timezone, 'Asia/Jakarta'))::date into v_today from public.businesses b where b.id = p_business_id;
  if p_business_date is null or p_business_date > v_today then raise exception 'Tanggal tidak boleh di masa depan'; end if;
  return btrim(p_reason);
end $$;
revoke all on function public._outlet_income_check(date, numeric, text, uuid) from public, anon, authenticated;

create or replace function public.owner_add_outlet_income(p_outlet_id uuid, p_business_date date, p_amount numeric, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_reason text;
  r public.outlet_income%rowtype;
begin
  if p_outlet_id is null or not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mencatat kas'); end if;
  v_reason := public._outlet_income_check(p_business_date, p_amount, p_reason, b);
  insert into public.outlet_income(business_id, outlet_id, business_date, amount, reason, created_by)
  values (b, p_outlet_id, p_business_date, p_amount, v_reason, auth.uid())
  returning * into r;
  return jsonb_build_object('id', r.id, 'businessDate', r.business_date, 'amount', r.amount, 'reason', r.reason, 'createdAt', r.created_at);
end $$;
revoke all on function public.owner_add_outlet_income(uuid, date, numeric, text) from public, anon;
grant execute on function public.owner_add_outlet_income(uuid, date, numeric, text) to authenticated;

create or replace function public.owner_update_outlet_income(p_id uuid, p_business_date date, p_amount numeric, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_reason text;
  r public.outlet_income%rowtype;
begin
  select * into r from public.outlet_income where id = p_id for update;
  if not found or not public.is_owner_of_outlet(r.outlet_id) then raise exception 'Pemasukan tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mengubah kas'); end if;
  v_reason := public._outlet_income_check(p_business_date, p_amount, p_reason, b);
  update public.outlet_income set business_date = p_business_date, amount = p_amount, reason = v_reason
  where id = p_id returning * into r;
  return jsonb_build_object('id', r.id, 'businessDate', r.business_date, 'amount', r.amount, 'reason', r.reason, 'createdAt', r.created_at);
end $$;
revoke all on function public.owner_update_outlet_income(uuid, date, numeric, text) from public, anon;
grant execute on function public.owner_update_outlet_income(uuid, date, numeric, text) to authenticated;

create or replace function public.owner_delete_outlet_income(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  r public.outlet_income%rowtype;
begin
  select * into r from public.outlet_income where id = p_id for update;
  if not found or not public.is_owner_of_outlet(r.outlet_id) then raise exception 'Pemasukan tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('menghapus kas'); end if;
  delete from public.outlet_income where id = p_id;
end $$;
revoke all on function public.owner_delete_outlet_income(uuid) from public, anon;
grant execute on function public.owner_delete_outlet_income(uuid) to authenticated;

-- The income between two business days, newest first, ten a page. A null outlet means every outlet of the business (as the
-- expense list does). Sum and total count every row of the period.
create or replace function public.owner_list_outlet_income(p_outlet_id uuid, p_from date, p_to date, p_page integer default 1)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  off integer := (greatest(coalesce(p_page, 1), 1) - 1) * 10;
begin
  if p_outlet_id is not null and not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > 400 then raise exception 'Rentang tanggal terlalu panjang'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.outlet_income i
      where i.business_id = b and (p_outlet_id is null or i.outlet_id = p_outlet_id) and i.business_date between p_from and p_to),
    'sum', (select coalesce(sum(i.amount), 0) from public.outlet_income i
      where i.business_id = b and (p_outlet_id is null or i.outlet_id = p_outlet_id) and i.business_date between p_from and p_to),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'outletId', x.outlet_id, 'businessDate', x.business_date, 'amount', x.amount,
          'reason', x.reason, 'createdAt', x.created_at)
        order by x.business_date desc, x.created_at desc, x.id)
      from (
        select i.* from public.outlet_income i
        where i.business_id = b and (p_outlet_id is null or i.outlet_id = p_outlet_id) and i.business_date between p_from and p_to
        order by i.business_date desc, i.created_at desc, i.id
        limit 10 offset off
      ) x
    ), '[]'::jsonb));
end $$;
revoke all on function public.owner_list_outlet_income(uuid, date, date, integer) from public, anon;
grant execute on function public.owner_list_outlet_income(uuid, date, date, integer) to authenticated;
