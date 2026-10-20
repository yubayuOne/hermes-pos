-- Tests for 045 (expense pages, shift history period, notification cleanup) on top of 001 to 077 (expenses recorded by the owner).
-- Every line of output must start with PASS. Speed is checked by perf_volume.sql, not here.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
create or replace function pg_temp.rec(k text, amount int) returns jsonb language sql as $$
  select public.owner_add_expense_items(current_setting('t.sh')::uuid, 'other',
    jsonb_build_array(jsonb_build_object('name', 'Es', 'category', 'belanja', 'quantity', 1, 'unit', 'pcs', 'amount', amount)))
$$;

insert into auth.users(id, email) values ('b4500000-0000-0000-0000-000000000001', 'rara@kedai.id');
select set_config('request.jwt.claim.sub', 'b4500000-0000-0000-0000-000000000001', false);
set role authenticated;
select set_config('t.reg', public.register_business('Kedai Rara', 'Pusat', null)::text, false);
select set_config('t.b', current_setting('t.reg')::jsonb ->> 'business_id', false);
select set_config('t.o', current_setting('t.reg')::jsonb ->> 'outlet_id', false);
reset role;
update public.subscriptions set plan_code = 'monthly', expires_at = now() + interval '20 days' where business_id = current_setting('t.b')::uuid;
set role authenticated;
select public.owner_create_cashier(current_setting('t.o')::uuid, 'Rara', '123456');
select set_config('t.c', (select cashier_id::text from public.owner_list_cashiers() where cashier_name = 'Rara'), false);

-- Three shifts with one expense each: 10.000, 20.000, 30.000. Older ones moved back in time.
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
select pg_temp.rec('a', 10000);
select public.close_shift(current_setting('t.sh')::uuid, 0);
reset role;
update public.shifts set opened_at = now() - interval '40 days' where id = current_setting('t.sh')::uuid;
update public.expenses set created_at = now() - interval '40 days' where shift_id = current_setting('t.sh')::uuid;
set role authenticated;
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
select pg_temp.rec('b', 20000);
select public.close_shift(current_setting('t.sh')::uuid, 0);
reset role;
update public.shifts set opened_at = now() - interval '2 days' where id = current_setting('t.sh')::uuid;
update public.expenses set created_at = now() - interval '2 days' where shift_id = current_setting('t.sh')::uuid;
set role authenticated;
select set_config('t.sh', public.open_shift(current_setting('t.c')::uuid, current_setting('t.o')::uuid, 0)::text, false);
select pg_temp.rec('c', 30000);

-- Expense pages: newest first, the cursor continues, totals cover the whole range.
select set_config('t.p1', public.owner_list_expenses(null, null, null, null, 2)::text, false);
select pg_temp.ok('E1 page 1: 2 of 3 rows, newest first, totals for all 60.000',
  jsonb_array_length(current_setting('t.p1')::jsonb -> 'rows') = 2 and (current_setting('t.p1')::jsonb ->> 'total')::int = 3
  and (current_setting('t.p1')::jsonb -> 'rows' -> 0 ->> 'total')::numeric = 30000
  and (current_setting('t.p1')::jsonb -> 'totals' ->> 'total')::numeric = 60000);
select set_config('t.p2', public.owner_list_expenses(null, null, null, (current_setting('t.p1')::jsonb -> 'rows' -> 1 ->> 'createdAt')::timestamptz, 2)::text, false);
select pg_temp.ok('E2 page 2: the last row, nothing repeated',
  jsonb_array_length(current_setting('t.p2')::jsonb -> 'rows') = 1 and (current_setting('t.p2')::jsonb -> 'rows' -> 0 ->> 'total')::numeric = 10000);
select set_config('t.p3', public.owner_list_expenses(null, now() - interval '30 days')::text, false);
select pg_temp.ok('E3 30 days: 2 rows, total 2, totals 50.000, default page size',
  jsonb_array_length(current_setting('t.p3')::jsonb -> 'rows') = 2 and (current_setting('t.p3')::jsonb ->> 'total')::int = 2
  and (current_setting('t.p3')::jsonb -> 'totals' ->> 'total')::numeric = 50000);
select pg_temp.ok('E4 page size is capped at 100', jsonb_array_length(public.owner_list_expenses(null, null, null, null, 100000) -> 'rows') = 3);

-- Shift history with a period.
select pg_temp.ok('S1 all shifts: 3', jsonb_array_length(public.list_outlet_shifts(current_setting('t.c')::uuid, current_setting('t.o')::uuid)) = 3);
select pg_temp.ok('S2 last 7 days: 2, newest first, open one on top',
  jsonb_array_length(public.list_outlet_shifts(current_setting('t.c')::uuid, current_setting('t.o')::uuid, null, 30, now() - interval '7 days')) = 2
  and public.list_outlet_shifts(current_setting('t.c')::uuid, current_setting('t.o')::uuid, null, 30, now() - interval '7 days') -> 0 ->> 'status' = 'open');

-- Notification cleanup: only read ones older than 90 days go.
reset role;
insert into public.notifications(business_id, kind, params, dedupe_key, created_at, read_at) values
  (current_setting('t.b')::uuid, 'x', '{}', 'old-read', now() - interval '100 days', now() - interval '99 days'),
  (current_setting('t.b')::uuid, 'x', '{}', 'old-unread', now() - interval '100 days', null),
  (current_setting('t.b')::uuid, 'x', '{}', 'new-read', now() - interval '10 days', now());
select pg_temp.ok('N1 cleanup removes 1: old and read', public.cleanup_notifications() = 1);
select pg_temp.ok('N2 old unread and recent read stay',
  (select count(*) from public.notifications where business_id = current_setting('t.b')::uuid and dedupe_key in ('old-unread', 'new-read')) = 2
  and not exists (select 1 from public.notifications where dedupe_key = 'old-read'));
set role authenticated;
do $$ begin
  perform public.cleanup_notifications();
  raise notice 'FAIL N3 clients cannot call cleanup';
exception when others then raise notice 'PASS N3 clients cannot call cleanup -> %', sqlerrm;
end $$;
reset role;
