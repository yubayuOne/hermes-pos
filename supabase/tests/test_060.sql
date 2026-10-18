-- Tests for 060 (POS sign-in with a username) on top of 001 to 060.
-- Every line of output must start with PASS.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', (case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end) || label; end $$;
create or replace function pg_temp.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL % (no error)', label;
exception when others then
  raise notice '%', (case when sqlerrm ilike '%' || expect || '%' then 'PASS ' else 'FAIL ' end) || label || ' -> ' || sqlerrm;
end $$;

-- Supabase keeps a bcrypt hash here; the local stand-in has no such column.
alter table auth.users add column if not exists encrypted_password text;
insert into auth.users(id, email, encrypted_password)
values ('b6000000-0000-0000-0000-000000000001', 'enam@kedai.id', crypt('123456', gen_salt('bf')));
insert into public.profiles(user_id, username) values ('b6000000-0000-0000-0000-000000000001', 'kedaienam');

set role anon;
select pg_temp.ok('L1 right username and password give the email', public.pos_login_email(' KedaiEnam ', '123456') = 'enam@kedai.id');
select pg_temp.ok('L2 letters only password is checked like any other', public.pos_login_email('kedaienam', 'abcdef') is null);
select pg_temp.ok('L3 unknown username gives nothing', public.pos_login_email('nobody', '123456') is null);
select pg_temp.ok('L4 empty password gives nothing', public.pos_login_email('kedaienam', '') is null);
select pg_temp.ok('L5 injection text is not a username', public.pos_login_email($$' or 1=1--$$, '123456') is null);
select pg_temp.fails('L6 anon cannot read the attempt table', 'select * from public.login_attempts', 'permission denied');
reset role;

select pg_temp.ok('L7 a wrong password is counted', (select failures from public.login_attempts where user_id = 'b6000000-0000-0000-0000-000000000001') = 1);
select public.pos_login_email('kedaienam', 'wrong' || g) from generate_series(1, 9) g;
select pg_temp.fails('L8 ten wrong passwords lock the username', $q$select public.pos_login_email('kedaienam', '123456')$q$, 'Terlalu banyak percobaan');
update public.login_attempts set window_start = now() - interval '16 minutes';
select pg_temp.ok('L9 the lock ends after 15 minutes', public.pos_login_email('kedaienam', '123456') = 'enam@kedai.id');
select pg_temp.ok('L10 a right password clears the count', not exists (select 1 from public.login_attempts));
select pg_temp.ok('L11 resolve_login_email stays service-only', not has_function_privilege('anon', 'public.resolve_login_email(text)', 'execute'));
