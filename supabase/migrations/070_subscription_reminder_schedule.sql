-- Replaces 069 (owner's request, 18 Oct 2026): the old schedule stays, and the last days get a reminder every day.
--   * Paid plans: one reminder at 30, 21, 14, and 7 days left (as in 030 and 064).
--   * Every plan, trial included: one reminder a day from 3 days left until the last day.
-- Reminders are kept (none replaced), like before 069. The dedupe keys make repeated calls on the same day free; 069's
-- daily keys ('expiring:YYYY-MM-DD:…') never match these, so a reminder made under 069 stays as it is.
create or replace function public.refresh_subscription_notifications(p_business_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s record;
  days integer;
  t integer;
  pick integer;
  stamp text;
  v_kind text;
  v_tz text := public.business_tz(p_business_id);
begin
  select sub.*, p.is_trial into s from public.subscriptions sub join public.plans p on p.code = sub.plan_code where sub.business_id = p_business_id;
  if not found then return; end if;
  stamp := to_char(s.expires_at at time zone v_tz, 'YYYY-MM-DD');
  if s.expires_at <= now() then
    insert into public.notifications(business_id, kind, params, dedupe_key)
    values (p_business_id, 'subscription_expired', jsonb_build_object('expires_at', s.expires_at, 'plan_code', s.plan_code), 'expired:' || stamp)
    on conflict (business_id, dedupe_key) do nothing;
    return;
  end if;
  days := (s.expires_at at time zone v_tz)::date - (now() at time zone v_tz)::date;
  v_kind := case when s.is_trial then 'trial_expiring' else 'subscription_expiring' end;

  if days <= 3 then
    insert into public.notifications(business_id, kind, params, dedupe_key)
    values (p_business_id, v_kind, jsonb_build_object('days_left', days, 'expires_at', s.expires_at, 'plan_code', s.plan_code),
            'expiring:day:' || to_char(now() at time zone v_tz, 'YYYY-MM-DD') || ':' || stamp)
    on conflict (business_id, dedupe_key) do nothing;
    return;
  end if;
  if s.is_trial then return; end if;

  foreach t in array array[30, 21, 14, 7] loop
    if days <= t then pick := t; end if;
  end loop;
  if pick is null then return; end if;
  insert into public.notifications(business_id, kind, params, dedupe_key)
  values (p_business_id, v_kind, jsonb_build_object('days_left', days, 'threshold', pick, 'expires_at', s.expires_at, 'plan_code', s.plan_code),
          'expiring:' || pick || ':' || stamp)
  on conflict (business_id, dedupe_key) do nothing;
end $$;
revoke all on function public.refresh_subscription_notifications(uuid) from public, anon, authenticated;
