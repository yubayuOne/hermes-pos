-- 060: the POS signs the owner in with a username too (owner's choice, 18 Oct 2026).
-- The backoffice turns a username into the email with the service role (031); a phone cannot hold that key. This
-- function gives the email to anyone only with the right password, so it never reveals an email to a stranger. Ten wrong
-- passwords in 15 minutes lock the username for the rest of that window. The app then signs in with Supabase Auth as
-- usual. Whether a username exists is already public (username_available, for the sign-up form).

create table if not exists public.login_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failures int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from public, anon, authenticated;

create or replace function public.pos_login_email(p_username text, p_password text)
returns text language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v text := lower(trim(coalesce(p_username, '')));
  v_user uuid; v_email text; v_hash text; a public.login_attempts;
begin
  if v !~ '^[a-z0-9_.]{3,20}$' or coalesce(p_password, '') = '' then return null; end if;
  select u.id, u.email, u.encrypted_password into v_user, v_email, v_hash
  from public.profiles p join auth.users u on u.id = p.user_id where p.username = v;
  if v_user is null then return null; end if;

  insert into public.login_attempts(user_id) values (v_user) on conflict (user_id) do nothing;
  select * into a from public.login_attempts where user_id = v_user for update;
  if a.window_start < now() - interval '15 minutes' then
    update public.login_attempts set failures = 0, window_start = now() where user_id = v_user;
    a.failures := 0;
  end if;
  if a.failures >= 10 then
    raise exception 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.' using hint = 'login_locked';
  end if;

  if v_hash is not null and v_hash = crypt(p_password, v_hash) then
    delete from public.login_attempts where user_id = v_user;
    return v_email;
  end if;
  update public.login_attempts set failures = failures + 1 where user_id = v_user;
  return null;
end $$;
revoke all on function public.pos_login_email(text, text) from public;
grant execute on function public.pos_login_email(text, text) to anon, authenticated;
