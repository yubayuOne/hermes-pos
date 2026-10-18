-- KASBOX Cash Ledger
-- The cash drawer is represented by an append-only ledger.
-- Shift expected cash is derived from ledger entries, not reconstructed in the UI.

create type public.cash_ledger_direction as enum ('in','out');

create table public.cash_ledger (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  cashier_id uuid not null,
  outlet_id uuid not null references public.outlets(id),
  direction public.cash_ledger_direction not null,
  amount numeric(14,2) not null check (amount >= 0),
  reason text not null,
  source_type text not null,
  source_id uuid,
  created_at timestamptz not null default now()
);

create index cash_ledger_shift_created on public.cash_ledger(shift_id, created_at);
create unique index cash_ledger_source_unique
  on public.cash_ledger(source_type, source_id)
  where source_id is not null;

alter table public.cash_ledger enable row level security;
create policy "cashier reads own cash ledger" on public.cash_ledger
  for select using (exists (
    select 1 from public.cashier_sessions cs
    where cs.auth_user_id = auth.uid()
      and cs.cashier_id = cash_ledger.cashier_id
      and cs.outlet_id = cash_ledger.outlet_id
      and cs.is_active
  ));

-- Backfill opening cash for existing shifts. New shifts get the same entry in open_shift().
insert into public.cash_ledger(
  shift_id, cashier_id, outlet_id, direction, amount, reason, source_type, source_id
)
select s.id, s.cashier_id, s.outlet_id, 'in', s.opening_cash,
       'Modal awal shift', 'shift_opening', s.id
from public.shifts s
where s.opening_cash > 0
  and not exists (
  select 1 from public.cash_ledger cl
  where cl.source_type = 'shift_opening' and cl.source_id = s.id
);

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
  if p_opening_cash < 0 then raise exception 'Modal kas tidak valid'; end if;

  -- Serialize concurrent open requests for the same cashier.
  perform pg_advisory_xact_lock(hashtextextended(p_cashier_id::text, 0));

  if exists(
    select 1
    from public.shifts
    where cashier_id=p_cashier_id
      and status='open'
  ) then
    raise exception 'Masih ada shift aktif untuk kasir ini';
  end if;

  select coalesce(max(s.shift_number),0) + 1
    into v_shift_number
  from public.shifts s
  where s.cashier_id=p_cashier_id
    and s.outlet_id=p_outlet_id
    and s.business_date=v_business_date;

  insert into public.shifts(
    cashier_id,outlet_id,business_date,shift_number,opening_cash
  )
  values(
    p_cashier_id,p_outlet_id,v_business_date,v_shift_number,p_opening_cash
  )
  returning id into sid;

  if p_opening_cash > 0 then
    insert into public.cash_ledger(
      shift_id,cashier_id,outlet_id,direction,amount,reason,source_type,source_id
    ) values (
      sid,p_cashier_id,p_outlet_id,'in',p_opening_cash,'Modal awal shift','shift_opening',sid
    );
  end if;

  return sid;
end;
$$;

grant execute on function public.open_shift(uuid,uuid,numeric) to authenticated;

-- Maintain a single cash-ledger entry for every paid cash payment.
create or replace function public.sync_cash_ledger_payment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_shift_id uuid;
  v_cashier_id uuid;
  v_outlet_id uuid;
  v_net numeric;
begin
  delete from public.cash_ledger
  where source_type = 'payment'
    and source_id = coalesce(new.id, old.id);

  if new.id is null then
    return new;
  end if;

  if new.status <> 'paid' or new.method <> 'cash' then
    return new;
  end if;

  select t.shift_id, t.cashier_id, t.outlet_id
    into v_shift_id, v_cashier_id, v_outlet_id
  from public.transactions t
  where t.id = new.transaction_id;

  if not found then
    raise exception 'Transaksi pembayaran tidak ditemukan';
  end if;

  v_net := new.amount_received - new.change_amount;
  if v_net <= 0 then
    raise exception 'Nilai kas transaksi tidak valid';
  end if;

  insert into public.cash_ledger(
    shift_id,cashier_id,outlet_id,direction,amount,reason,source_type,source_id
  ) values (
    v_shift_id,v_cashier_id,v_outlet_id,'in',v_net,'Penjualan tunai','payment',new.id
  );

  return new;
end;
$$;

drop trigger if exists payments_cash_ledger on public.payments;
create trigger payments_cash_ledger
after insert or update of method, amount_received, change_amount, status on public.payments
for each row execute function public.sync_cash_ledger_payment();

-- Manual cash movement: petty cash, owner cash-in, corrections with an explicit reason.
create or replace function public.create_cash_movement(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_direction public.cash_ledger_direction,
  p_amount numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
begin
  if p_amount <= 0 then raise exception 'Nominal kas harus lebih dari nol'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Alasan kas wajib diisi'; end if;

  perform public.assert_open_shift(p_shift_id,p_cashier_id,p_outlet_id);

  insert into public.cash_ledger(
    shift_id,cashier_id,outlet_id,direction,amount,reason,source_type
  ) values (
    p_shift_id,p_cashier_id,p_outlet_id,p_direction,p_amount,trim(p_reason),'manual'
  ) returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_cash_movement(uuid,uuid,uuid,public.cash_ledger_direction,numeric,text) to authenticated;

create or replace function public.get_shift_cash_summary(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_shift public.shifts%rowtype;
  v_in numeric := 0;
  v_out numeric := 0;
  v_expected numeric := 0;
begin
  select * into v_shift from public.shifts where id=p_shift_id;
  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(v_shift.cashier_id,v_shift.outlet_id);

  select
    coalesce(sum(case when direction='in' then amount else 0 end),0),
    coalesce(sum(case when direction='out' then amount else 0 end),0)
  into v_in,v_out
  from public.cash_ledger
  where shift_id=p_shift_id;

  v_expected := v_in - v_out;

  return jsonb_build_object(
    'cash_in',v_in,
    'cash_out',v_out,
    'expected_cash',v_expected
  );
end;
$$;

grant execute on function public.get_shift_cash_summary(uuid) to authenticated;

-- Rebuild close_shift on top of the ledger. The shift row remains locked,
-- therefore checkout/manual cash movement cannot interleave with closure.
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
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_expected_cash numeric := 0;
  v_variance_amount numeric := 0;
  v_held_count integer := 0;
begin
  select * into v_shift
  from public.shifts
  where id=p_shift_id
  for update;

  if not found then raise exception 'Shift tidak ditemukan'; end if;
  perform public.assert_cashier(v_shift.cashier_id,v_shift.outlet_id);
  if p_physical_cash < 0 then raise exception 'Kas fisik tidak valid'; end if;
  if v_shift.status <> 'open' then raise exception 'Shift sudah ditutup'; end if;

  select count(*)::integer into v_held_count
  from public.transactions t
  where t.shift_id=v_shift.id and t.status='held';

  if v_held_count > 0 then
    raise exception 'Masih ada % Bill Ditahan. Selesaikan atau batalkan Bill Ditahan sebelum menutup shift.',v_held_count;
  end if;

  select
    coalesce(sum(case when direction='in' then amount else 0 end),0),
    coalesce(sum(case when direction='out' then amount else 0 end),0)
  into v_cash_in,v_cash_out
  from public.cash_ledger
  where shift_id=v_shift.id;

  v_expected_cash := v_cash_in - v_cash_out;
  v_variance_amount := p_physical_cash - v_expected_cash;

  update public.shifts
  set closed_at=now(), closing_cash=p_physical_cash,
      expected_cash=v_expected_cash, variance=v_variance_amount, status='closed'
  where id=v_shift.id;

  return jsonb_build_object(
    'expected_cash',v_expected_cash,
    'variance',v_variance_amount,
    'cash_in',v_cash_in,
    'cash_out',v_cash_out
  );
end;
$$;

grant execute on function public.close_shift(uuid,numeric) to authenticated;
