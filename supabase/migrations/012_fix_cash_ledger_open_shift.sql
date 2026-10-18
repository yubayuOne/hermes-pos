-- Fix Cash Ledger v3 open_shift regression.
-- v3 accidentally omitted business_date and shift_number from the INSERT,
-- although both columns are NOT NULL in public.shifts.
-- Keep all existing POS Core invariants and also create the opening ledger entry atomically.

create or replace function public.open_shift(
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_opening_cash numeric
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  sid uuid;
  v_business_date date := (now() at time zone 'Asia/Jakarta')::date;
  v_shift_number integer;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);

  if p_opening_cash < 0 then
    raise exception 'Modal kas tidak valid';
  end if;

  -- Serialize concurrent requests from the same cashier.
  perform pg_advisory_xact_lock(hashtextextended(p_cashier_id::text, 0));

  if exists (
    select 1
    from public.shifts
    where cashier_id = p_cashier_id
      and status = 'open'
  ) then
    raise exception 'Masih ada shift aktif untuk kasir ini';
  end if;

  select coalesce(max(s.shift_number), 0) + 1
    into v_shift_number
  from public.shifts s
  where s.cashier_id = p_cashier_id
    and s.outlet_id = p_outlet_id
    and s.business_date = v_business_date;

  insert into public.shifts (
    cashier_id,
    outlet_id,
    business_date,
    shift_number,
    opening_cash
  )
  values (
    p_cashier_id,
    p_outlet_id,
    v_business_date,
    v_shift_number,
    p_opening_cash
  )
  returning id into sid;

  if p_opening_cash > 0 then
    insert into public.cash_ledger (
      shift_id,
      cashier_id,
      outlet_id,
      direction,
      amount,
      reason,
      source_type,
      source_id
    )
    values (
      sid,
      p_cashier_id,
      p_outlet_id,
      'in',
      p_opening_cash,
      'Modal awal shift',
      'shift_opening',
      sid
    );
  end if;

  return sid;
end;
$$;

grant execute on function public.open_shift(uuid, uuid, numeric) to authenticated;
