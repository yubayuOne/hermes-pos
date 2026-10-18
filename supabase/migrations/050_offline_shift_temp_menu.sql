-- 050: open and close a shift and add a temporary menu item while the POS is offline (owner's request, 16 Oct 2026).
-- The phone makes the id (uuid) and keeps the action in its queue; these functions accept that id, so a resend after a
-- lost answer returns the same row instead of a second one. The old functions stay as they are for older app builds.
-- Money is still decided here: expected cash and variance come from the ledger when the close arrives.

-- ---------------------------------------------------------------- 1. open a shift with the phone's id
create or replace function public.open_shift_with_id(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_opening_cash numeric,
  p_opened_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  s public.shifts%rowtype;
  -- The time the cashier opened it on the phone, never in the future and at most 3 days back.
  v_opened timestamptz := least(now(), greatest(coalesce(p_opened_at, now()), now() - interval '3 days'));
  v_business_date date := (v_opened at time zone 'Asia/Jakarta')::date;
  v_shift_number integer;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);
  if p_shift_id is null then raise exception 'ID shift tidak valid'; end if;
  if p_opening_cash is null or p_opening_cash < 0 then raise exception 'Modal kas tidak valid'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cashier_id::text, 0));

  -- Resend of a shift that was already opened.
  select * into s from public.shifts where id = p_shift_id;
  if found then
    if s.cashier_id <> p_cashier_id or s.outlet_id <> p_outlet_id then raise exception 'ID shift tidak valid'; end if;
    return s.id;
  end if;

  if exists (select 1 from public.shifts where cashier_id = p_cashier_id and status = 'open') then
    raise exception 'Masih ada shift aktif untuk kasir ini';
  end if;

  select coalesce(max(x.shift_number), 0) + 1 into v_shift_number
  from public.shifts x
  where x.cashier_id = p_cashier_id and x.outlet_id = p_outlet_id and x.business_date = v_business_date;

  insert into public.shifts (id, cashier_id, outlet_id, business_date, shift_number, opening_cash, opened_at)
  values (p_shift_id, p_cashier_id, p_outlet_id, v_business_date, v_shift_number, p_opening_cash, v_opened);

  if p_opening_cash > 0 then
    insert into public.cash_ledger (shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id)
    values (p_shift_id, p_cashier_id, p_outlet_id, 'in', p_opening_cash, 'Modal awal shift', 'shift_opening', p_shift_id);
  end if;

  return p_shift_id;
end;
$$;
revoke all on function public.open_shift_with_id(uuid, uuid, uuid, numeric, timestamptz) from public, anon;
grant execute on function public.open_shift_with_id(uuid, uuid, uuid, numeric, timestamptz) to authenticated;

-- ---------------------------------------------------------------- 2. close a shift, safe to resend
create or replace function public.close_shift_at(
  p_shift_id uuid,
  p_physical_cash numeric,
  p_closed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_shift public.shifts%rowtype;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_expected_cash numeric := 0;
  v_variance_amount numeric := 0;
  v_held_count integer := 0;
  v_closed timestamptz;
begin
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(v_shift.cashier_id, v_shift.outlet_id);
  if p_physical_cash is null or p_physical_cash < 0 then raise exception 'Kas fisik tidak valid'; end if;

  select
    coalesce(sum(case when direction = 'in' then amount else 0 end), 0),
    coalesce(sum(case when direction = 'out' then amount else 0 end), 0)
  into v_cash_in, v_cash_out
  from public.cash_ledger where shift_id = v_shift.id;

  -- Resend of the same close (the answer was lost): the stored result, not an error.
  if v_shift.status <> 'open' then
    if v_shift.closing_cash = p_physical_cash then
      return jsonb_build_object('expected_cash', v_shift.expected_cash, 'variance', v_shift.variance, 'cash_in', v_cash_in, 'cash_out', v_cash_out);
    end if;
    raise exception 'Shift sudah ditutup';
  end if;

  select count(*)::integer into v_held_count from public.transactions t where t.shift_id = v_shift.id and t.status = 'held';
  if v_held_count > 0 then
    raise exception 'Masih ada % Bill Ditahan. Selesaikan atau batalkan Bill Ditahan sebelum menutup shift.', v_held_count;
  end if;

  v_expected_cash := v_cash_in - v_cash_out;
  v_variance_amount := p_physical_cash - v_expected_cash;
  -- The time the cashier closed it on the phone, between the opening and now.
  v_closed := least(now(), greatest(coalesce(p_closed_at, now()), v_shift.opened_at));

  update public.shifts
  set closed_at = v_closed, closing_cash = p_physical_cash, expected_cash = v_expected_cash, variance = v_variance_amount, status = 'closed'
  where id = v_shift.id;

  return jsonb_build_object('expected_cash', v_expected_cash, 'variance', v_variance_amount, 'cash_in', v_cash_in, 'cash_out', v_cash_out);
end;
$$;
revoke all on function public.close_shift_at(uuid, numeric, timestamptz) from public, anon;
grant execute on function public.close_shift_at(uuid, numeric, timestamptz) to authenticated;

-- ---------------------------------------------------------------- 3. temporary menu item with the phone's id
create or replace function public.create_temporary_product_with_id(
  p_product_id uuid,
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_name text,
  p_price numeric,
  p_station public.product_station default 'kitchen'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.products%rowtype;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);
  if p_product_id is null then raise exception 'ID menu tidak valid'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Nama menu sementara wajib diisi'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Harga menu sementara harus lebih dari nol'; end if;

  select * into p from public.products where id = p_product_id;
  if found then
    if p.outlet_id <> p_outlet_id or not p.is_temporary then raise exception 'ID menu tidak valid'; end if;
    return p.id;
  end if;

  perform public.cleanup_temporary_products(p_outlet_id);

  insert into public.products (id, outlet_id, category_id, name, hpp, selling_price, stock, station, is_active, is_temporary)
  values (p_product_id, p_outlet_id, null, trim(p_name), 0, p_price, 999999, p_station, true, true);

  return p_product_id;
end;
$$;
revoke all on function public.create_temporary_product_with_id(uuid, uuid, uuid, text, numeric, public.product_station) from public, anon;
grant execute on function public.create_temporary_product_with_id(uuid, uuid, uuid, text, numeric, public.product_station) to authenticated;
