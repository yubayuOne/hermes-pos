-- KASBOX Shift management fix
-- Fixes ambiguous PL/pgSQL variable/column reference in close_shift.
-- Also keeps the existing Business Date / Shift Number rules from migration 006.

create or replace function public.close_shift(
  p_shift_id uuid,
  p_physical_cash numeric
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_shift public.shifts%rowtype;
  v_cash_sales numeric := 0;
  v_expected numeric := 0;
  v_variance numeric := 0;
begin
  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if not found then
    raise exception 'Shift tidak ditemukan';
  end if;

  perform public.assert_cashier(v_shift.cashier_id, v_shift.outlet_id);

  if p_physical_cash < 0 then
    raise exception 'Kas fisik tidak valid';
  end if;

  if v_shift.status <> 'open' then
    raise exception 'Shift sudah ditutup';
  end if;

  select coalesce(sum(p.amount_received - p.change_amount), 0)
    into v_cash_sales
  from public.payments p
  join public.transactions t on t.id = p.transaction_id
  where t.shift_id = v_shift.id
    and t.status = 'completed'
    and p.method = 'cash'
    and p.status = 'paid';

  v_expected := v_shift.opening_cash + v_cash_sales;
  v_variance := p_physical_cash - v_expected;

  update public.shifts s
  set closed_at = now(),
      closing_cash = p_physical_cash,
      expected_cash = v_expected,
      variance = v_variance,
      status = 'closed'
  where s.id = v_shift.id;

  return jsonb_build_object(
    'expected_cash', v_expected,
    'variance', v_variance
  );
end $$;

grant execute on function public.close_shift(uuid,numeric) to authenticated;
