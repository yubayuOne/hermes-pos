-- 065: an "Unlimited" plan the HERMES POS admin grants by hand (owner's request, 18 Oct 2026): it never ends and has no
-- practical limit on outlets, cashiers, or products. It is never sold: plan_quote and admin_activate_subscription refuse
-- it, so neither a payment confirmation nor a paid activation can turn into it. Granted only with
-- admin_grant_unlimited(email), which the SQL Editor (service role) can call and signed-in users cannot.

insert into public.plans(code, name, price, duration_months, duration_days, cashiers_per_outlet, products_per_outlet, is_trial, sort_order)
values ('unlimited', 'Unlimited', 0, 0, 0, 100000, 100000, false, 99)
on conflict (code) do update set name = excluded.name, price = excluded.price, duration_months = excluded.duration_months,
  duration_days = excluded.duration_days, cashiers_per_outlet = excluded.cashiers_per_outlet,
  products_per_outlet = excluded.products_per_outlet, is_trial = excluded.is_trial, sort_order = excluded.sort_order;

-- The public plan list (030) shows only the plans on sale; server functions still read Unlimited.
drop policy if exists "anyone reads plans" on public.plans;
create policy "anyone reads plans" on public.plans for select using (code <> 'unlimited');

-- Same as 030, plus no outlet cap for Unlimited (extra_outlets stays 0..50 for paid plans).
create or replace function public.business_limits(p_business_id uuid, out max_outlets integer, out cashiers_per_outlet integer, out products_per_outlet integer)
language sql stable security definer set search_path = public as $$
  select case when p.is_trial then 1 when p.code = 'unlimited' then 100000 else 1 + s.extra_outlets end, p.cashiers_per_outlet, p.products_per_outlet
  from public.subscriptions s join public.plans p on p.code = s.plan_code
  where s.business_id = p_business_id
$$;

-- Same as 031, Unlimited is not for sale.
create or replace function public.plan_quote(p_plan text, p_extra_outlets integer)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare t public.plans%rowtype;
begin
  select * into t from public.plans where code = p_plan and not is_trial and code <> 'unlimited';
  if not found then raise exception 'Pilih paket Bulanan, 6 bulan, atau Tahunan.' using errcode = '22023'; end if;
  if coalesce(p_extra_outlets, 0) < 0 or p_extra_outlets > 50 then raise exception 'Jumlah outlet tambahan tidak valid.' using errcode = '22023'; end if;
  return t.price + coalesce(p_extra_outlets, 0) * public.extra_outlet_price() * t.duration_months;
end $$;

-- Same as 030, Unlimited is granted only by admin_grant_unlimited.
create or replace function public.admin_activate_subscription(p_business_id uuid, p_plan_code text, p_extra_outlets integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.plans%rowtype; s public.subscriptions%rowtype; base timestamptz;
begin
  select * into p from public.plans where code = p_plan_code;
  if not found or p.is_trial or p.code = 'unlimited' then raise exception 'Paket tidak valid: pakai monthly, semiannual, atau annual'; end if;
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

-- Gives the business owned by this email the Unlimited plan, ending 31 Dec 9999. Admin only (SQL Editor).
create or replace function public.admin_grant_unlimited(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_business uuid; s public.subscriptions%rowtype;
begin
  select m.business_id into v_business
  from auth.users u join public.business_members m on m.auth_user_id = u.id and m.role = 'owner'
  where lower(u.email) = lower(btrim(p_email));
  if v_business is null then raise exception 'Akun % belum punya bisnis. Daftar dan selesaikan langkah awal dulu.', p_email; end if;
  insert into public.subscriptions(business_id, plan_code, started_at, expires_at, extra_outlets, trial_used, updated_at)
  values (v_business, 'unlimited', now(), '9999-12-31 23:59:59+00', 0, true, now())
  on conflict (business_id) do update set plan_code = 'unlimited', started_at = now(), expires_at = '9999-12-31 23:59:59+00',
    extra_outlets = 0, updated_at = now()
  returning * into s;
  return to_jsonb(s);
end $$;
revoke all on function public.admin_grant_unlimited(text) from public, anon, authenticated;
grant execute on function public.admin_grant_unlimited(text) to service_role;
