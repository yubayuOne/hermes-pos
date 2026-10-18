-- 056: the backoffice summary with the period's expenses (owner's request, 17 Oct 2026).
-- Every expense is subtracted from the sales, whether it was paid from the drawer or not: the summary shows sales,
-- expenses (drawer / other, operasional / belanja), and sales after expenses. Both totals come from the existing
-- functions (owner_sales_summary 045, owner_list_expenses 045), so the numbers match the Ringkasan and Pengeluaran
-- pages; only the difference is new, and it is made here, not in the browser. Read only.

create or replace function public.owner_summary_with_expenses(
  p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_sales jsonb := public.owner_sales_summary(p_outlet_id, p_from, p_to, p_prev_from, p_prev_to);
  v_totals jsonb := public.owner_list_expenses(p_outlet_id, p_from, p_to, null, 1) -> 'totals';
  v_drawer numeric;
  v_other numeric;
begin
  -- Same rows as owner_list_expenses (business, outlet, created_at in the period), split by where the money came from.
  select
    coalesce(sum(i.amount) filter (where i.paid_from = 'drawer'), 0),
    coalesce(sum(i.amount) filter (where i.paid_from = 'other'), 0)
  into v_drawer, v_other
  from public.expenses e join public.expense_items i on i.expense_id = e.id
  where e.business_id = b and (p_outlet_id is null or e.outlet_id = p_outlet_id)
    and (p_from is null or e.created_at >= p_from) and (p_to is null or e.created_at < p_to);

  return v_sales || jsonb_build_object(
    'expenses', jsonb_build_object(
      'total', coalesce((v_totals ->> 'total')::numeric, 0),
      'operasional', coalesce((v_totals ->> 'operasional')::numeric, 0),
      'belanja', coalesce((v_totals ->> 'belanja')::numeric, 0),
      'drawer', v_drawer,
      'other', v_other),
    'salesAfterExpenses', coalesce((v_sales ->> 'sales')::numeric, 0) - coalesce((v_totals ->> 'total')::numeric, 0)
  );
end $$;
revoke all on function public.owner_summary_with_expenses(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_summary_with_expenses(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;
