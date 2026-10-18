-- 051: a shift belongs to the phone that opened it (owner's choice, 16 Oct 2026).
-- Shifts were per cashier, so the same cashier signed in on two phones could close the shift on phone B while phone A
-- was offline; A's queued sales were then refused. Now only the opening phone writes into or closes its shift. A lost or
-- broken phone's shift moves to another phone with the owner's approval code (the void code, migration 032).
--
-- The phone sends its id in the x-device-id request header (a random id made at install). Without the header (older
-- app builds, the SQL Editor) or on shifts opened before this migration, nothing changes. The header is not a secret:
-- the POS signs in with the owner's account, so this keeps phones consistent, it is not an access control.

alter table public.shifts add column if not exists device_id text;

create or replace function public.request_device_id()
returns text
language plpgsql
stable
set search_path=public
as $$
begin
  return nullif(btrim(coalesce((nullif(current_setting('request.headers', true), '')::json)->>'x-device-id', '')), '');
exception when others then
  return null;
end;
$$;
revoke all on function public.request_device_id() from public, anon;
grant execute on function public.request_device_id() to authenticated;

-- Raised whenever another phone tries to write into or close the shift. The app shows it and offers the takeover.
create or replace function public.assert_shift_device(p_device_id text)
returns void
language plpgsql
stable
set search_path=public
as $$
declare v_me text := public.request_device_id();
begin
  if p_device_id is not null and v_me is not null and p_device_id <> v_me then
    raise exception 'Shift ini dibuka di HP lain.' using errcode = 'P0001', hint = 'shift_other_device';
  end if;
end;
$$;
revoke all on function public.assert_shift_device(text) from public, anon;
grant execute on function public.assert_shift_device(text) to authenticated;

-- ---------------------------------------------------------------- 1. every write into a shift goes through this
-- Same body as 009, plus the phone check. Checkout, held bills, expenses, refunds and voids all call it.
create or replace function public.assert_open_shift(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_outlet_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_status public.shift_status;
  v_device text;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);

  select s.status, s.device_id
    into v_status, v_device
  from public.shifts s
  where s.id = p_shift_id
    and s.cashier_id = p_cashier_id
    and s.outlet_id = p_outlet_id
  for update;

  if not found or v_status <> 'open' then
    raise exception 'Shift aktif tidak ditemukan';
  end if;
  perform public.assert_shift_device(v_device);
end;
$$;
grant execute on function public.assert_open_shift(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- 2. opening records the phone
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
  v_opened timestamptz := least(now(), greatest(coalesce(p_opened_at, now()), now() - interval '3 days'));
  v_business_date date := (v_opened at time zone 'Asia/Jakarta')::date;
  v_shift_number integer;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);
  if p_shift_id is null then raise exception 'ID shift tidak valid'; end if;
  if p_opening_cash is null or p_opening_cash < 0 then raise exception 'Modal kas tidak valid'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cashier_id::text, 0));

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

  insert into public.shifts (id, cashier_id, outlet_id, business_date, shift_number, opening_cash, opened_at, device_id)
  values (p_shift_id, p_cashier_id, p_outlet_id, v_business_date, v_shift_number, p_opening_cash, v_opened, public.request_device_id());

  if p_opening_cash > 0 then
    insert into public.cash_ledger (shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id)
    values (p_shift_id, p_cashier_id, p_outlet_id, 'in', p_opening_cash, 'Modal awal shift', 'shift_opening', p_shift_id);
  end if;

  return p_shift_id;
end;
$$;
revoke all on function public.open_shift_with_id(uuid, uuid, uuid, numeric, timestamptz) from public, anon;
grant execute on function public.open_shift_with_id(uuid, uuid, uuid, numeric, timestamptz) to authenticated;

-- ---------------------------------------------------------------- 3. only the opening phone closes it
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

  if v_shift.status <> 'open' then
    if v_shift.closing_cash = p_physical_cash then
      return jsonb_build_object('expected_cash', v_shift.expected_cash, 'variance', v_shift.variance, 'cash_in', v_cash_in, 'cash_out', v_cash_out);
    end if;
    raise exception 'Shift sudah ditutup';
  end if;
  perform public.assert_shift_device(v_shift.device_id);

  select count(*)::integer into v_held_count from public.transactions t where t.shift_id = v_shift.id and t.status = 'held';
  if v_held_count > 0 then
    raise exception 'Masih ada % Bill Ditahan. Selesaikan atau batalkan Bill Ditahan sebelum menutup shift.', v_held_count;
  end if;

  v_expected_cash := v_cash_in - v_cash_out;
  v_variance_amount := p_physical_cash - v_expected_cash;
  v_closed := least(now(), greatest(coalesce(p_closed_at, now()), v_shift.opened_at));

  update public.shifts
  set closed_at = v_closed, closing_cash = p_physical_cash, expected_cash = v_expected_cash, variance = v_variance_amount, status = 'closed'
  where id = v_shift.id;

  return jsonb_build_object('expected_cash', v_expected_cash, 'variance', v_variance_amount, 'cash_in', v_cash_in, 'cash_out', v_cash_out);
end;
$$;
revoke all on function public.close_shift_at(uuid, numeric, timestamptz) from public, anon;
grant execute on function public.close_shift_at(uuid, numeric, timestamptz) to authenticated;

-- The pre-050 close, still used by older builds: also refuses another phone when it sends its id.
do $$ begin
  if to_regprocedure('public.close_shift_legacy_050(uuid,numeric)') is null then
    alter function public.close_shift(uuid, numeric) rename to close_shift_legacy_050;
  end if;
end $$;
revoke all on function public.close_shift_legacy_050(uuid, numeric) from public, anon, authenticated;
create or replace function public.close_shift(p_shift_id uuid, p_physical_cash numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_shift_device((select device_id from public.shifts where id = p_shift_id));
  return public.close_shift_legacy_050(p_shift_id, p_physical_cash);
end $$;
revoke all on function public.close_shift(uuid, numeric) from public, anon;
grant execute on function public.close_shift(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------- 4. move a shift to this phone (owner's code)
-- For a lost or broken phone. Wrong codes return a result instead of raising, so the attempt count is kept (as 032).
-- Whatever the old phone still had in its queue is refused afterwards: the owner is told so in the app first.
create or replace function public.take_over_shift(p_shift_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.shifts%rowtype;
  vc public.business_void_codes%rowtype;
  b uuid;
  v_failed integer;
  v_me text := public.request_device_id();
begin
  if v_me is null then raise exception 'ID perangkat tidak terkirim. Perbarui aplikasi.'; end if;
  select * into s from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(s.cashier_id, s.outlet_id);
  if s.status <> 'open' then raise exception 'Shift sudah ditutup'; end if;
  if s.device_id is not distinct from v_me then return jsonb_build_object('ok', true); end if;

  b := public.business_of_outlet(s.outlet_id);
  select * into vc from public.business_void_codes where business_id = b for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_code'); end if;
  if vc.locked_until is not null and vc.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', vc.locked_until);
  end if;
  if coalesce(p_code, '') !~ '^[0-9]{6}$' or vc.code_hash <> crypt(p_code, vc.code_hash) then
    v_failed := vc.failed + 1;
    if v_failed >= 5 then
      update public.business_void_codes set failed = 0, locked_until = now() + interval '5 minutes' where business_id = b;
      return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', now() + interval '5 minutes');
    end if;
    update public.business_void_codes set failed = v_failed where business_id = b;
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'attempts_left', 5 - v_failed);
  end if;
  update public.business_void_codes set failed = 0, locked_until = null where business_id = b;

  update public.shifts set device_id = v_me where id = s.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.take_over_shift(uuid, text) from public, anon;
grant execute on function public.take_over_shift(uuid, text) to authenticated;
