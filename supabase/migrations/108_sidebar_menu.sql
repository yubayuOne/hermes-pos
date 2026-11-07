-- 108: The owner picks which menus show in the back office sidebar (owner's request, 7 Nov 2026). Per business: every
-- user of the business sees the same sidebar. Hidden menus stay reachable by their address; Pengaturan is always shown.

alter table public.businesses add column if not exists sidebar_hidden text[] not null default '{}';

create or replace function public.owner_get_business()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'name', b.name, 'business_type', b.business_type, 'city', b.city,
    'timezone', b.timezone, 'receipt', b.receipt, 'notify', b.notify, 'sidebar_hidden', b.sidebar_hidden)
  from public.businesses b where b.id = public.require_owner_business();
$$;
grant execute on function public.owner_get_business() to authenticated;

-- The menus that can be hidden: every item of the sidebar. Keep this list in step with lib/nav.ts.
create or replace function public.owner_update_sidebar(p_hidden text[])
returns text[]
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_keys text[] := array['/', '/transactions', '/closing', '/expenses', '/stock', '/customers', '/products', '/ingredients',
    '/resep', '/tables', '/vouchers', '/outlets', '/cashiers'];
  v_hidden text[] := array(select distinct unnest(coalesce(p_hidden, '{}'::text[])));
  k text;
begin
  foreach k in array v_hidden loop
    if not (k = any(v_keys)) then raise exception 'Menu tidak dikenal: %', k using errcode = '22023'; end if;
  end loop;
  if cardinality(v_hidden) >= cardinality(v_keys) then raise exception 'Sisakan minimal satu menu di sidebar.' using errcode = '22023'; end if;
  update public.businesses set sidebar_hidden = v_hidden where id = b;
  return v_hidden;
end $$;
revoke all on function public.owner_update_sidebar(text[]) from public, anon;
grant execute on function public.owner_update_sidebar(text[]) to authenticated;
