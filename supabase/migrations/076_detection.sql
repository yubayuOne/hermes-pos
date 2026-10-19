-- Bookkeeping, stage 5 (docs/ACCOUNTING.md sections 8 and 9): the owner hears about what needs a look.
--
-- 1) A void (not a bill correction, which the owner makes): a notification like the refund one (033).
-- 2) A shift closed with a cash or QRIS difference of at least Rp10.000, or more than 1% of the shift's net sales.
-- 3) Every night (pg_cron, 05:00 WIB): for each outlet of an active business, the balance checks of the last 8 days, days
--    of the last two weeks that are 2 or more days old and not closed, and shifts open for more than 16 hours.
-- Notifications go to the bell; each one at most once (dedupe_key), the nightly ones once per outlet per day.

-- ---------------------------------------------------------------- 1) voids
create or replace function public.trg_notify_void()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'voided' and old.status = 'completed' and coalesce(new.void_reason, '') not like 'Dikoreksi:%' then
    insert into public.notifications(business_id, kind, params, dedupe_key)
    select o.business_id, 'void', jsonb_build_object('number', new.number, 'amount', old.total, 'reason', coalesce(new.void_reason, ''),
      'cashier', (select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = new.cashier_id limit 1))
    , 'void:' || new.id
    from public.outlets o where o.id = new.outlet_id and o.business_id is not null
    on conflict (business_id, dedupe_key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists transaction_notify_void on public.transactions;
create trigger transaction_notify_void after update of status on public.transactions
  for each row execute function public.trg_notify_void();
revoke all on function public.trg_notify_void() from public, anon, authenticated;

-- ---------------------------------------------------------------- 2) shift differences
-- A difference worth a look: Rp10.000 or more, or more than 1% of the shift's net sales.
create or replace function public.notable_difference(p_amount numeric, p_sales numeric)
returns boolean
language sql immutable as $$
  select coalesce(p_amount, 0) <> 0 and (abs(p_amount) >= 10000 or abs(p_amount) > 0.01 * greatest(coalesce(p_sales, 0), 0))
$$;

create or replace function public.trg_notify_shift_difference()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sales numeric;
begin
  if new.status = 'closed' and old.status = 'open' then
    select -coalesce(sum(amount), 0) into v_sales from public.ledger where shift_id = new.id and account in ('sales', 'discount', 'sales_return');
    if public.notable_difference(new.variance, v_sales) or public.notable_difference(new.qris_variance, v_sales) then
      insert into public.notifications(business_id, kind, params, dedupe_key)
      select o.business_id, 'shift_difference', jsonb_build_object('outlet', o.name, 'shift', new.shift_number,
        'cashier', (select cs.cashier_name from public.cashier_sessions cs where cs.cashier_id = new.cashier_id limit 1),
        'cash', coalesce(new.variance, 0), 'qris', coalesce(new.qris_variance, 0), 'date', new.business_date), 'shift_difference:' || new.id
      from public.outlets o where o.id = new.outlet_id and o.business_id is not null
      on conflict (business_id, dedupe_key) do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists shift_notify_difference on public.shifts;
create trigger shift_notify_difference after update of status on public.shifts
  for each row execute function public.trg_notify_shift_difference();
revoke all on function public.trg_notify_shift_difference() from public, anon, authenticated;

-- ---------------------------------------------------------------- 3) the nightly watch
create or replace function public.watch_books()
returns void
language plpgsql security definer set search_path = public as $$
declare
  o record;
  v_today date;
  v_checks jsonb;
  v_days integer;
  v_oldest date;
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

    select count(distinct s.business_date)::integer, min(s.business_date) into v_days, v_oldest
    from public.shifts s
    where s.outlet_id = o.id and s.business_date between v_today - 14 and v_today - 2
      and not exists (select 1 from public.day_closes d where d.outlet_id = o.id and d.business_date = s.business_date);
    if v_days > 0 then
      insert into public.notifications(business_id, kind, params, dedupe_key)
      values (o.business_id, 'day_not_closed', jsonb_build_object('outlet', o.name, 'days', v_days, 'date', v_oldest),
        'day_not_closed:' || o.id || ':' || v_today)
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

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'hermes-pos-watch-books') then
      perform cron.unschedule('hermes-pos-watch-books');
    end if;
    -- 22:00 UTC = 05:00 WIB, after the cleanups and before the morning shift.
    perform cron.schedule('hermes-pos-watch-books', '0 22 * * *', 'select public.watch_books()');
  end if;
end $$;
