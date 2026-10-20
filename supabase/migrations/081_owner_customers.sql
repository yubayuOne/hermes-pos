-- Customers in the backoffice (owner's decision, 21 Oct 2026): every name typed on a paid bill, with how many bills and
-- how much was spent in a period. The cashier app records only a free-text name, so a customer is a name: the same
-- letters ignoring case and extra spaces. Voided and held bills do not count; refunds come off the total.

create or replace function public.owner_customers(p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_search text default null, p_page integer default 1)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_q text := nullif(lower(regexp_replace(btrim(coalesce(p_search, '')), '\s+', ' ', 'g')), '');
  off integer := (greatest(coalesce(p_page, 1), 1) - 1) * 50;
begin
  if p_outlet_id is not null and not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_to <= p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal terlalu panjang'; end if;

  return (
    with bills as (
      select regexp_replace(btrim(t.customer_name), '\s+', ' ', 'g') as shown, t.created_at,
        t.total - coalesce((select sum(r.amount) from public.transaction_refunds r where r.transaction_id = t.id), 0) as net
      from public.transactions t join public.outlets o on o.id = t.outlet_id
      where o.business_id = b and (p_outlet_id is null or t.outlet_id = p_outlet_id)
        and t.status = 'completed' and t.created_at >= p_from and t.created_at < p_to
        and btrim(coalesce(t.customer_name, '')) <> ''
    ),
    c as (
      -- The name as it was typed last time stands for the group.
      select lower(shown) as k, (array_agg(shown order by created_at desc))[1] as name, count(*) as bills, sum(net) as total,
        max(created_at) as last_at
      from bills
      where v_q is null or position(v_q in lower(shown)) > 0
      group by lower(shown)
    )
    select jsonb_build_object(
      'total', (select count(*) from c),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object('name', x.name, 'bills', x.bills, 'total', x.total, 'lastAt', x.last_at) order by x.total desc, x.k)
        from (select * from c order by total desc, k limit 50 offset off) x
      ), '[]'::jsonb)
    )
  );
end $$;
revoke all on function public.owner_customers(uuid, timestamptz, timestamptz, text, integer) from public, anon;
grant execute on function public.owner_customers(uuid, timestamptz, timestamptz, text, integer) to authenticated;
