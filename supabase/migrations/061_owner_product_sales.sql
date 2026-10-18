-- Quantity sold per product for one outlet and period: the Terjual column on the backoffice Produk page.
-- Completed bills only, like Produk terlaris (owner_sales_summary.top); refunds are not subtracted.
create or replace function public.owner_product_sales(p_outlet_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  perform public.require_owner_business();
  if not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_to <= p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal terlalu panjang'; end if;

  -- { "<product id>": qty }; transactions_outlet_created covers the bill scan.
  select coalesce(jsonb_object_agg(x.product_id, x.qty), '{}'::jsonb) into result
  from (
    select ti.product_id, sum(ti.quantity) as qty
    from public.transactions t
    join public.transaction_items ti on ti.transaction_id = t.id
    where t.outlet_id = p_outlet_id and t.status = 'completed' and t.created_at >= p_from and t.created_at < p_to
      and ti.product_id is not null
    group by 1
  ) x;
  return result;
end $$;

revoke all on function public.owner_product_sales(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_product_sales(uuid, timestamptz, timestamptz) to authenticated;
