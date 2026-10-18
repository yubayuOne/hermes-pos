-- The days left are no longer shown on Ringkasan (owner's request, 18 Oct 2026); the bell reminds instead, once a day.
-- Inside the reminder window (a trial: the whole trial; a paid plan: the last 30 days, the window the Ringkasan banner
-- used) one reminder is made per business day, and yesterday's reminder is removed so the bell holds only the current
-- count. Expiry keeps its single notification. Still called by get_subscription_status, so it runs when the owner opens
-- the backoffice; the dedupe key makes repeated calls on the same day free.
create or replace function public.refresh_subscription_notifications(p_business_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s record;
  days integer;
  stamp text;
  v_key text;
  v_tz text := public.business_tz(p_business_id);
begin
  select sub.*, p.is_trial into s from public.subscriptions sub join public.plans p on p.code = sub.plan_code where sub.business_id = p_business_id;
  if not found then return; end if;
  stamp := to_char(s.expires_at at time zone v_tz, 'YYYY-MM-DD');
  if s.expires_at <= now() then
    delete from public.notifications where business_id = p_business_id and dedupe_key like 'expiring:%';
    insert into public.notifications(business_id, kind, params, dedupe_key)
    values (p_business_id, 'subscription_expired', jsonb_build_object('expires_at', s.expires_at, 'plan_code', s.plan_code), 'expired:' || stamp)
    on conflict (business_id, dedupe_key) do nothing;
    return;
  end if;
  days := (s.expires_at at time zone v_tz)::date - (now() at time zone v_tz)::date;
  if not s.is_trial and days > 30 then
    delete from public.notifications where business_id = p_business_id and dedupe_key like 'expiring:%';
    return;
  end if;

  v_key := 'expiring:' || to_char(now() at time zone v_tz, 'YYYY-MM-DD') || ':' || stamp;
  delete from public.notifications where business_id = p_business_id and dedupe_key like 'expiring:%' and dedupe_key <> v_key;
  insert into public.notifications(business_id, kind, params, dedupe_key)
  values (p_business_id, case when s.is_trial then 'trial_expiring' else 'subscription_expiring' end,
          jsonb_build_object('days_left', days, 'expires_at', s.expires_at, 'plan_code', s.plan_code), v_key)
  on conflict (business_id, dedupe_key) do nothing;
end $$;
revoke all on function public.refresh_subscription_notifications(uuid) from public, anon, authenticated;
