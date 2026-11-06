-- Report in four parts (prompt 5): the raw rows the report book needs, in one call next to owner_report_page (063/071).
-- Only the owner of the business reads it; the outlet must belong to the business (or null = every outlet of it);
-- the range is valid and at most 400 days. Rows are compact arrays, so the page can group them without more calls.
--   bills:    [local time 'YYYY-MM-DDTHH24:MI', total, method, customer name, subtotal]   completed bills only
--   items:    [local day, menu name, portions, menu value (qty x selling price, before discounts)]
--   expenses: [business day of the shift, category, item name, quantity, unit, amount, paid from]   every item still in expense_items (a cancelled item is moved out, 073)
-- An outlet admin role does not exist in this schema, so there is nothing to restrict beyond the owner check.
create or replace function public.owner_report_detail(p_outlet_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_tz text := public.business_tz(b);
begin
  if p_outlet_id is not null and not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal terlalu panjang'; end if;

  return jsonb_build_object(
    'bills', coalesce((
      select jsonb_agg(jsonb_build_array(to_char(t.created_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI'), t.total, t.payment_method::text,
        t.customer_name, t.subtotal) order by t.created_at, t.id)
      from public.transactions t join public.outlets o on o.id = t.outlet_id
      where o.business_id = b and (p_outlet_id is null or t.outlet_id = p_outlet_id)
        and t.status = 'completed' and t.created_at >= p_from and t.created_at < p_to
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_array(x.day, x.name, x.qty, x.value) order by x.day, x.name)
      from (
        select (t.created_at at time zone v_tz)::date::text as day, min(p.name) as name,
          sum(ti.quantity) as qty, sum(ti.quantity * ti.selling_price_unit) as value
        from public.transaction_items ti
        join public.transactions t on t.id = ti.transaction_id and t.status = 'completed'
        join public.outlets o on o.id = t.outlet_id
        join public.products p on p.id = ti.product_id
        where o.business_id = b and (p_outlet_id is null or t.outlet_id = p_outlet_id)
          and t.created_at >= p_from and t.created_at < p_to
        group by 1, lower(btrim(p.name))
      ) x
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_array(s.business_date::text, i.category, i.name, i.quantity, i.unit, i.amount, i.paid_from)
        order by s.business_date, i.name)
      from public.expense_items i
      join public.expenses e on e.id = i.expense_id
      join public.shifts s on s.id = e.shift_id
      join public.outlets o on o.id = e.outlet_id
      where o.business_id = b and (p_outlet_id is null or e.outlet_id = p_outlet_id)
        and e.created_at >= p_from and e.created_at < p_to
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.owner_report_detail(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_report_detail(uuid, timestamptz, timestamptz) to authenticated;
