-- 055: one shift as the POS shows it, in one read (offline architecture, stage 3; owner's choice, 17 Oct 2026).
-- Every bill of the shift (any status, made on any phone), the items of each, the refunds, the expenses and the
-- server's own report. The phone keeps it in its local database, so the Bill tab and the shift report work offline,
-- and a bill made on another phone shows as soon as either phone was online. Built only from the functions the app
-- already calls one by one, so every number is the server's. `version` as in 052: unchanged content = no download.
-- Read only.

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

  -- All rows of list_shift_bills (100 per page there), in the shape the Bill tab already reads.
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
    'report', public.get_shift_report(p_shift_id)
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
