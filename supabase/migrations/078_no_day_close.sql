-- No Tutup hari and no day lock (owner's decision, 21 Oct 2026). The cashier closes each shift in the app; the owner fixes
-- a shift's cash with Uang masuk / Uang keluar on any day, at any time. Days closed before this stay in day_closes as
-- history (their QRIS bank lines stay in the ledger), but they no longer block changes and no new day can be closed.

-- Every lock trigger of 075 asks these two; never locked now.
create or replace function public.day_locked(p_outlet uuid, p_date date)
returns boolean
language sql stable security definer set search_path = public as $$
  select false
$$;
create or replace function public.shift_day_locked(p_shift_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select false
$$;

revoke all on function public.owner_close_day(uuid, date, numeric, text) from public, anon, authenticated;
revoke all on function public.owner_reopen_day(uuid, date, text) from public, anon, authenticated;

-- Same as 076 without the "day not closed" reminder.
create or replace function public.watch_books()
returns void
language plpgsql security definer set search_path = public as $$
declare
  o record;
  v_today date;
  v_checks jsonb;
begin
  for o in select ou.id, ou.name, ou.business_id from public.outlets ou where public.subscription_active(ou.business_id) loop
    v_today := (now() at time zone public.outlet_tz(o.id))::date;
    v_checks := public.ledger_checks(o.business_id, o.id, now() - interval '8 days', now() + interval '1 second');
    if v_checks <> '[]'::jsonb then
      insert into public.notifications(business_id, kind, params, dedupe_key)
      values (o.business_id, 'checks_failed', jsonb_build_object('outlet', o.name, 'count', jsonb_array_length(v_checks)),
        'checks_failed:' || o.id || ':' || v_today)
      on conflict (business_id, dedupe_key) do nothing;
    end if;
  end loop;

  insert into public.notifications(business_id, kind, params, dedupe_key)
  select ou.business_id, 'shift_open_long', jsonb_build_object('outlet', ou.name, 'shift', s.shift_number, 'openedAt', s.opened_at,
    'cashier', (select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = s.cashier_id limit 1)), 'shift_open_long:' || s.id
  from public.shifts s join public.outlets ou on ou.id = s.outlet_id
  where s.status = 'open' and s.opened_at < now() - interval '16 hours' and public.subscription_active(ou.business_id)
  on conflict (business_id, dedupe_key) do nothing;
end $$;
revoke all on function public.watch_books() from public, anon, authenticated;
