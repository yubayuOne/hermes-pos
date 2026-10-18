-- Tests for 070 (subscription reminders at 30, 21, 14, 7 days, then every day from 3 days left) on top of 001 to 070.
-- Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
create or replace function pg_temp.reminders() returns int language sql as $$
  select count(*)::int from public.notifications where business_id = current_setting('t.b')::uuid and dedupe_key like 'expiring:%'
$$;
create or replace function pg_temp.left_in(d text) returns void language sql as $$
  update public.subscriptions set expires_at = now() + d::interval where business_id = current_setting('t.b')::uuid;
  select public.refresh_subscription_notifications(current_setting('t.b')::uuid);
$$;
-- Yesterday's daily reminder, as if the owner opened the backoffice then.
create or replace function pg_temp.yesterday() returns void language sql as $$
  insert into public.notifications(business_id, kind, params, dedupe_key)
  values (current_setting('t.b')::uuid, 'subscription_expiring', '{"days_left": 3}',
    'expiring:day:' || to_char((now() at time zone 'Asia/Jakarta')::date - 1, 'YYYY-MM-DD') || ':'
      || to_char((select expires_at from public.subscriptions where business_id = current_setting('t.b')::uuid) at time zone 'Asia/Jakarta', 'YYYY-MM-DD'));
$$;

insert into auth.users(id, email) values ('e7000000-0000-0000-0000-000000000001', 'gita@kopi.id');
select set_config('request.jwt.claim.sub', 'e7000000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.b', public.register_business('Kopi Gita', 'Pusat', null) ->> 'business_id', false);
select public.get_subscription_status();
reset role;
select pg_temp.ok('T1 a 3-day trial is reminded on its first day', pg_temp.reminders() = 1
  and (select kind from public.notifications where business_id = current_setting('t.b')::uuid and dedupe_key like 'expiring:%') = 'trial_expiring');
select public.refresh_subscription_notifications(current_setting('t.b')::uuid);
select pg_temp.ok('T2 not twice on the same day', pg_temp.reminders() = 1);

delete from public.notifications where business_id = current_setting('t.b')::uuid;
update public.subscriptions set plan_code = 'monthly' where business_id = current_setting('t.b')::uuid;
select pg_temp.left_in('45 days');
select pg_temp.ok('P1 45 days left: nothing yet', pg_temp.reminders() = 0);
select pg_temp.left_in('20 days 2 hours');
select pg_temp.left_in('13 days 2 hours');
select pg_temp.left_in('13 days 3 hours');
select pg_temp.ok('P2 the old schedule: one at 21, one at 14, no repeat inside a step', pg_temp.reminders() = 2
  and (select array_agg((params ->> 'threshold')::int order by (params ->> 'threshold')::int) from public.notifications
       where business_id = current_setting('t.b')::uuid and dedupe_key like 'expiring:%') = array[14, 21]);
select pg_temp.left_in('5 days 2 hours');
select pg_temp.ok('P3 still the schedule at 5 days (the 7-day one), no daily yet', pg_temp.reminders() = 3
  and not exists (select 1 from public.notifications where business_id = current_setting('t.b')::uuid and dedupe_key like 'expiring:day:%'));
select pg_temp.left_in('2 days 12 hours');
select pg_temp.yesterday();
select pg_temp.left_in('2 days 12 hours');
select pg_temp.ok('D1 from 3 days left: one a day, earlier ones kept', pg_temp.reminders() = 5
  and (select count(*) from public.notifications where business_id = current_setting('t.b')::uuid and dedupe_key like 'expiring:day:%') = 2);
select pg_temp.ok('D2 today''s daily reminder says how many days are left',
  (select (params ->> 'days_left')::int from public.notifications where business_id = current_setting('t.b')::uuid
     and dedupe_key = 'expiring:day:' || to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD') || ':'
       || to_char((select expires_at from public.subscriptions where business_id = current_setting('t.b')::uuid) at time zone 'Asia/Jakarta', 'YYYY-MM-DD'))
  between 2 and 3);

select pg_temp.left_in('-1 hour');
select pg_temp.ok('E1 expired: one expiry notice', (select count(*) from public.notifications
  where business_id = current_setting('t.b')::uuid and kind = 'subscription_expired') = 1);
