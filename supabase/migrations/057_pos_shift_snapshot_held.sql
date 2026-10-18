-- 057: pos_shift_snapshot (055) also carries what the Shift tab and a held bill need (offline architecture, stage 4;
-- owner's choice, 17 Oct 2026), so the phone keeps no copy of its own next to the local database:
-- * held: per held bill, the recall header (customer, table, bill discount) and its remaining items as
--   get_held_bill_items returns them (the same list recall_held_bill_with_items sends; also the split-bill count).
--   Read from the table directly: recall_held_bill locks the row (for update), which a sync must not do.
-- * cash: get_shift_cash_summary (kas laci from the cash book).
-- * dashboard: get_dashboard_summary for the shift (opening to close, or to now while open), for the hourly bars and
--   the best sellers. The comparison range is fixed just before the opening, so the version only changes with the data.
-- Same rules as 055: only the server's numbers, `version` = md5 of the content. Read only.

create or replace function public.pos_shift_snapshot(p_shift_id uuid, p_version text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.shifts%rowtype;
  v_rows jsonb := '[]'::jsonb;
  v_page jsonb;
  v_status text;
  v_offset integer;
  v jsonb;
  v_version text;
begin
  select * into s from public.shifts where id = p_shift_id;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(s.cashier_id, s.outlet_id);

  foreach v_status in array array['completed', 'held', 'voided'] loop
    v_offset := 0;
    loop
      v_page := coalesce(public.list_shift_bills(p_shift_id, v_status, '', 100, v_offset) -> 'rows', '[]'::jsonb);
      v_rows := v_rows || v_page;
      exit when jsonb_array_length(v_page) < 100;
      v_offset := v_offset + 100;
    end loop;
  end loop;

  -- shortcut: the whole shift each time a bill changes; fine for a few hundred bills, upgrade to rows changed since a
  -- timestamp (updated_at) when shifts get bigger.
  v := jsonb_build_object(
    'shift', jsonb_build_object(
      'id', s.id, 'cashier_id', s.cashier_id, 'outlet_id', s.outlet_id, 'business_date', s.business_date,
      'shift_number', s.shift_number, 'opened_at', s.opened_at, 'opening_cash', s.opening_cash, 'status', s.status,
      'closed_at', s.closed_at, 'closing_cash', s.closing_cash, 'expected_cash', s.expected_cash, 'variance', s.variance,
      'device_id', s.device_id),
    'bills', v_rows,
    'items', coalesce((select jsonb_object_agg(r ->> 'id', public.get_bill_items((r ->> 'id')::uuid)) from jsonb_array_elements(v_rows) r), '{}'::jsonb),
    'refunds', public.list_shift_refunds(p_shift_id),
    'expenses', public.list_shift_expenses(p_shift_id),
    'report', public.get_shift_report(p_shift_id),
    'held', coalesce((
      select jsonb_object_agg(t.id, jsonb_build_object(
        'customerName', t.customer_name, 'customerPhone', t.customer_phone, 'tableNumber', t.table_number,
        'billDiscountType', t.bill_discount_type, 'billDiscountValue', t.bill_discount_value,
        'items', public.get_held_bill_items(t.id)))
      from public.transactions t where t.shift_id = p_shift_id and t.status::text = 'held'
    ), '{}'::jsonb),
    'cash', public.get_shift_cash_summary(p_shift_id),
    'dashboard', public.get_dashboard_summary(
      s.cashier_id, s.outlet_id, s.opened_at,
      greatest(coalesce(s.closed_at, now()), s.opened_at + interval '1 minute'),
      s.opened_at - interval '1 minute', s.opened_at)
  );

  v_version := md5(v::text);
  if p_version is not null and p_version = v_version then
    return jsonb_build_object('version', v_version, 'unchanged', true);
  end if;
  return v || jsonb_build_object('version', v_version);
end;
$$;
revoke all on function public.pos_shift_snapshot(uuid, text) from public, anon;
grant execute on function public.pos_shift_snapshot(uuid, text) to authenticated;
