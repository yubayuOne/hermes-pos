-- KASBOX Shift Business Date
--
-- Rules:
-- 1. A shift belongs to the business date on which it was opened (Asia/Jakarta).
-- 2. Crossing 00:00 does NOT move an active shift to the next day.
-- 3. Transactions stay attached to the active shift, so transactions after midnight
--    still belong to the previous day's shift when that shift is still open.
-- 4. When all shifts for a business date are closed and a new shift is opened on
--    the next business date, numbering starts again at Shift 1.
-- 5. If a shift from yesterday is still open today, opening another shift is
--    rejected until the old shift is closed.
--
-- Run after 005_split_bill_iterative.sql.

alter table public.shifts
  add column if not exists business_date date;

alter table public.shifts
  add column if not exists shift_number integer;

-- Backfill existing shifts using the Indonesia business date of opened_at.
with numbered as (
  select
    id,
    (opened_at at time zone 'Asia/Jakarta')::date as v_business_date,
    row_number() over (
      partition by cashier_id, (opened_at at time zone 'Asia/Jakarta')::date
      order by opened_at, id
    )::integer as v_shift_number
  from public.shifts
)
update public.shifts s
set
  business_date = n.v_business_date,
  shift_number = n.v_shift_number
from numbered n
where s.id = n.id
  and (s.business_date is null or s.shift_number is null);

alter table public.shifts
  alter column business_date set default ((now() at time zone 'Asia/Jakarta')::date),
  alter column business_date set not null,
  alter column shift_number set not null;

alter table public.shifts
  add constraint shifts_shift_number_positive
  check (shift_number > 0);

create unique index if not exists shifts_cashier_business_date_number
  on public.shifts(cashier_id, business_date, shift_number);

-- Replaces the original function. Shift numbering is per cashier + business date.
-- The advisory lock prevents two simultaneous Open Shift requests from receiving
-- the same shift number.
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
  perform public.assert_cashier(p_cashier_id,p_outlet_id);

  if p_opening_cash < 0 then
    raise exception 'Modal kas tidak valid';
  end if;

  -- One active shift per cashier remains the hard rule, even across midnight.
  if exists(
    select 1
    from public.shifts
    where cashier_id=p_cashier_id
      and status='open'
  ) then
    raise exception 'Masih ada shift aktif untuk kasir ini';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_cashier_id::text || ':' || p_outlet_id::text || ':' || v_business_date::text,
      0
    )
  );

  select coalesce(max(s.shift_number),0) + 1
    into v_shift_number
    from public.shifts s
    where s.cashier_id=p_cashier_id
      and s.outlet_id=p_outlet_id
      and s.business_date=v_business_date;

  insert into public.shifts(
    cashier_id,
    outlet_id,
    business_date,
    shift_number,
    opening_cash
  )
  values(
    p_cashier_id,
    p_outlet_id,
    v_business_date,
    v_shift_number,
    p_opening_cash
  )
  returning id into sid;

  return sid;
end $$;

-- Explicit privileges for Supabase RPC callers.
grant execute on function public.open_shift(uuid,uuid,numeric) to authenticated;
