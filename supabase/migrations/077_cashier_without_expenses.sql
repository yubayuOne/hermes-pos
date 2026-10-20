-- The cashier app is for sales only (owner's decision, 21 Oct 2026). Expenses are recorded by the owner in the
-- backoffice and never come out of the drawer, so the expected cash of a shift is its sales and drawer movements only.
-- Old drawer expenses keep their cash book rows (ledger checks stay balanced); cancelling one still reverses its row.

-- The owner path (owner_add_expense_items) replaces the cashier's record_expense.
revoke all on function public.record_expense(uuid, uuid, uuid, text, jsonb, text) from public, anon, authenticated;

create or replace function public.owner_add_expense_items(p_shift_id uuid, p_paid_from text, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  s public.shifts%rowtype;
  e public.expenses%rowtype;
  v_items jsonb;
  v_count int := 0;
begin
  select * into s from public.shifts where id = p_shift_id;
  if not found or not public.is_owner_of_outlet(s.outlet_id) then raise exception 'Shift tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired('mencatat pengeluaran'); end if;
  if coalesce(p_paid_from, '') <> 'other' then raise exception 'Pengeluaran tidak diambil dari kas laci.'; end if;
  v_items := public.expense_items_checked(p_items, p_paid_from);
  if jsonb_array_length(v_items) > 30 then raise exception 'Maksimal 30 barang dalam satu catatan.'; end if;
  select * into s from public.shifts where id = p_shift_id for update;

  select * into e from public.expenses where shift_id = s.id;
  if e.id is null then
    insert into public.expenses(business_id, outlet_id, shift_id, cashier_id, total, entry_keys)
    values (b, s.outlet_id, s.id, s.cashier_id, 0, '{}')
    returning * into e;
  end if;
  select count(*) into v_count from public.expense_items where expense_id = e.id;
  if v_count + jsonb_array_length(v_items) > 200 then raise exception 'Pengeluaran shift ini sudah mencapai 200 barang.'; end if;
  insert into public.expense_items(expense_id, position, name, category, quantity, unit, amount, paid_from)
  select e.id, (v_count + x.ord - 1)::smallint, x.v->>'name', x.v->>'category', (x.v->>'quantity')::numeric, x.v->>'unit',
    (x.v->>'amount')::numeric, p_paid_from
  from jsonb_array_elements(v_items) with ordinality as x(v, ord);
  perform public._073_sync_expense(e.id);
  return public.expense_json(e.id);
end $$;
revoke all on function public.owner_add_expense_items(uuid, text, jsonb) from public, anon;
grant execute on function public.owner_add_expense_items(uuid, text, jsonb) to authenticated;
