-- Minimal stand-in for the objects migration 031 needs from 001 to 030, so 031 can be tested alone.
-- On a real project run the full migration chain instead (supabase db reset in the POS repo).
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;

create table public.businesses (id uuid primary key default gen_random_uuid(), name text not null, owner_id uuid not null references auth.users(id));
create table public.outlets (id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id), name text not null);
create table public.products (id uuid primary key default gen_random_uuid(), outlet_id uuid not null references public.outlets(id), name text not null,
  is_active boolean not null default true, is_temporary boolean not null default false);
create table public.subscriptions (business_id uuid primary key references public.businesses(id), plan_code text not null, expires_at timestamptz not null, extra_outlets int not null default 0);

create function public.my_business_id() returns uuid language sql stable security definer set search_path = public as
$$ select id from public.businesses where owner_id = auth.uid() $$;
create function public.require_owner_business() returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.my_business_id();
begin if v is null then raise exception 'Akun ini belum memiliki bisnis.'; end if; return v; end $$;
create function public.admin_activate_subscription(p_business_id uuid, p_plan_code text, p_extra_outlets int)
returns void language plpgsql security definer set search_path = public as $$
declare m int := case p_plan_code when 'monthly' then 1 when 'semiannual' then 6 when 'annual' then 12 end;
begin
  update public.subscriptions set plan_code = p_plan_code, extra_outlets = p_extra_outlets,
    expires_at = greatest(expires_at, now()) + make_interval(months => m) where business_id = p_business_id;
end $$;
-- Supabase grants table privileges to these roles by default; RLS decides which rows they see.
alter default privileges in schema public grant select on tables to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
