-- =========================================================
-- KASBOX - REGISTER CASHIER TEST SESSION
-- =========================================================

DO $$
DECLARE
  v_user_id uuid;
  v_outlet_id uuid;
BEGIN

  -- Ambil user dari Supabase Auth
  SELECT id
  INTO v_user_id
  FROM auth.users
  WHERE email = 'kasir@gmail.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'User dengan email kasir@kasbox.id belum terdaftar di Supabase Auth';
  END IF;

  -- Buat outlet testing jika belum ada
  SELECT id
  INTO v_outlet_id
  FROM public.outlets
  WHERE name = 'KASBOX Outlet 1'
  LIMIT 1;

  IF v_outlet_id IS NULL THEN
    INSERT INTO public.outlets (
      name,
      address,
      is_active
    )
    VALUES (
      'KASBOX Outlet 1',
      'Outlet Testing',
      true
    )
    RETURNING id INTO v_outlet_id;
  END IF;

  -- Nonaktifkan sesi aktif lama untuk user tersebut
  UPDATE public.cashier_sessions
  SET is_active = false
  WHERE auth_user_id = v_user_id
    AND is_active = true;

  -- Buat sesi kasir baru
  INSERT INTO public.cashier_sessions (
    auth_user_id,
    outlet_id,
    cashier_name,
    outlet_name,
    terminal_name,
    is_active
  )
  VALUES (
    v_user_id,
    v_outlet_id,
    'Kasir 1',
    'KASBOX Outlet 1',
    'POS 1',
    true
  );

END $$;