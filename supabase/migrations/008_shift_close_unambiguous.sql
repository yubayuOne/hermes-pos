-- KASBOX: definitive close-shift fix
-- Drops the previous 2-argument overload and recreates close_shift
-- with uniquely named local variables so column references are never ambiguous.

DROP FUNCTION IF EXISTS public.close_shift(uuid, numeric);

CREATE FUNCTION public.close_shift(
  p_shift_id uuid,
  p_physical_cash numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_cash_sales numeric := 0;
  v_expected_cash numeric := 0;
  v_variance_amount numeric := 0;
BEGIN
  SELECT *
    INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift tidak ditemukan';
  END IF;

  PERFORM public.assert_cashier(v_shift.cashier_id, v_shift.outlet_id);

  IF p_physical_cash < 0 THEN
    RAISE EXCEPTION 'Kas fisik tidak valid';
  END IF;

  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'Shift sudah ditutup';
  END IF;

  SELECT COALESCE(SUM(p.amount_received - p.change_amount), 0)
    INTO v_cash_sales
  FROM public.payments AS p
  JOIN public.transactions AS t
    ON t.id = p.transaction_id
  WHERE t.shift_id = v_shift.id
    AND t.status = 'completed'
    AND p.method = 'cash'
    AND p.status = 'paid';

  v_expected_cash := v_shift.opening_cash + v_cash_sales;
  v_variance_amount := p_physical_cash - v_expected_cash;

  UPDATE public.shifts AS sh
  SET closed_at = now(),
      closing_cash = p_physical_cash,
      expected_cash = v_expected_cash,
      variance = v_variance_amount,
      status = 'closed'
  WHERE sh.id = v_shift.id;

  RETURN jsonb_build_object(
    'expected_cash', v_expected_cash,
    'variance', v_variance_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_shift(uuid, numeric) TO authenticated;
