-- Tests for 069 (daily subscription reminder in the bell) on top of 001 to 069.
-- Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
create or replace function pg_temp.reminders() returns int language sql as $$
  select count(*)::int from public.notifications where business_id = current_setting('t.b')::uuid and dedupe_key like 'expiring:%'
$$;

insert into auth.users(id, email) values ('e6900000-0000-0000-0000-000000000001', 'fajar@kopi.id');
select set_config('request.jwt.claim.sub', 'e6900000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.b', public.register_business('Kopi Fajar', 'Pusat', null) ->> 'business_id', false);
select public.get_subscription_status();
reset role;
select pg_temp.ok('T1 a new trial is reminded at once', pg_temp.reminders() = 1
  and (select kind from public.notifications where business_id = current_setting('t.b')::uuid and dedupe_key like 'expiring:%') = 'trial_expiring');

update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '45 days' where business_id = current_setting('t.b')::uuid;
select public.refresh_subscription_notifications(current_setting('t.b')::uuid);
select pg_temp.ok('P1 a paid plan with 45 days left: no reminder, the old one is gone', pg_temp.reminders() = 0);

update public.subscriptions set expires_at = now() + interval '10 days' where business_id = current_setting('t.b')::uuid;
-- Yesterday's reminder, read already.
insert into public.notifications(business_id, kind, params, dedupe_key, read_at)
values (current_setting('t.b')::uuid, 'subscription_expiring', '{"days_left": 11}',
  'expiring:' || to_char((now() at time zone 'Asia/Jakarta')::date - 1, 'YYYY-MM-DD') || ':'
    || to_char((select expires_at from public.subscriptions where business_id = current_setting('t.b')::uuid) at time zone 'Asia/Jakarta', 'YYYY-MM-DD'),
  now() - interval '1 day');
select public.refresh_subscription_notifications(current_setting('t.b')::uuid);
select public.refresh_subscription_notifications(current_setting('t.b')::uuid);
select pg_temp.ok('D1 today: one new unread reminder replaces yesterday''s, called twice',
  pg_temp.reminders() = 1
  and (select read_at is null and (params ->> 'days_left')::int between 10 and 11
       from public.notifications where business_id = current_setting('t.b')::uuid and dedupe_key like 'expiring:%'));

update public.subscriptions set expires_at = now() - interval '1 hour' where business_id = current_setting('t.b')::uuid;
select public.refresh_subscription_notifications(current_setting('t.b')::uuid);
select pg_temp.ok('E1 expired: the countdown goes, one expiry notice stays',
  pg_temp.reminders() = 0
  and (select count(*) from public.notifications where business_id = current_setting('t.b')::uuid and kind = 'subscription_expired') = 1);
