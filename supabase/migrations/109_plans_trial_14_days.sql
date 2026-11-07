-- 109: new prices and a 14-day trial (owner's request, 7 Nov 2026).
--   Harian    1 hari    list Rp15.000   pay Rp7.000
--   Mingguan  7 hari    list Rp100.000  pay Rp47.000
--   Bulanan   1 bulan   list Rp500.000  pay Rp147.000
--   Tahunan   12 bulan  list Rp1.500.000 pay Rp697.000
-- Semiannual is retired: kept in the table (existing subscriptions and payments point at it) but no longer sold.
-- An extra outlet costs extra_outlet_price per plan (per month for Bulanan, per year for Tahunan).
-- Existing trials keep their 3 days; only businesses created from now on get 14.

alter table public.plans add column if not exists list_price bigint check (list_price is null or list_price >= 0);
alter table public.plans add column if not exists extra_outlet_price bigint not null default 0 check (extra_outlet_price >= 0);
alter table public.plans add column if not exists is_active boolean not null default true;

insert into public.plans(code, name, price, duration_months, duration_days, cashiers_per_outlet, products_per_outlet, is_trial, sort_order, list_price, extra_outlet_price, is_active) values
  ('trial', 'Trial', 0, 0, 14, 2, 40, true, 0, null, 0, true),
  ('daily', 'Harian', 7000, 0, 1, 3, 100, false, 1, 15000, 3000, true),
  ('weekly', 'Mingguan', 47000, 0, 7, 3, 100, false, 2, 100000, 23000, true),
  ('monthly', 'Bulanan', 147000, 1, 0, 3, 100, false, 3, 500000, 99000, true),
  ('annual', 'Tahunan', 697000, 12, 0, 3, 100, false, 5, 1500000, 1188000, true)
on conflict (code) do update set name = excluded.name, price = excluded.price, duration_months = excluded.duration_months,
  duration_days = excluded.duration_days, cashiers_per_outlet = excluded.cashiers_per_outlet,
  products_per_outlet = excluded.products_per_outlet, is_trial = excluded.is_trial, sort_order = excluded.sort_order,
  list_price = excluded.list_price, extra_outlet_price = excluded.extra_outlet_price, is_active = excluded.is_active;

update public.plans set is_active = false where code = 'semiannual';

-- Bisnis baru: trial 14 hari.
create or replace function public.trg_business_trial()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions(business_id, plan_code, started_at, expires_at)
  values (new.id, 'trial', now(), now() + interval '14 days')
  on conflict (business_id) do nothing;
  return new;
end $$;

-- The price a buyer owes: the paid plan's price plus each extra outlet at that plan's extra price. Only active paid plans.
create or replace function public.plan_quote(p_plan text, p_extra_outlets integer)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare t public.plans%rowtype;
begin
  select * into t from public.plans where code = p_plan and not is_trial and code <> 'unlimited' and is_active;
  if not found then raise exception 'Pilih paket Harian, Mingguan, Bulanan, atau Tahunan.' using errcode = '22023'; end if;
  if coalesce(p_extra_outlets, 0) < 0 or p_extra_outlets > 50 then raise exception 'Jumlah outlet tambahan tidak valid.' using errcode = '22023'; end if;
  return t.price + coalesce(p_extra_outlets, 0) * t.extra_outlet_price;
end $$;
