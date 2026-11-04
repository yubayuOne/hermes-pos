-- A bill with a zero total (owner's decision, 4 Nov 2026) is a sale that moves no cash. The payment trigger refused
-- any net cash of 0 and wrote nothing for it. Now zero is accepted and writes no row; a negative net is still refused.
-- The rest is 011, unchanged.

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
  if v_net < 0 then
    raise exception 'Nilai kas transaksi tidak valid';
  end if;
  -- A bill that costs nothing (a discount took the whole total) moves no cash, so there is no row to write.
  if v_net = 0 then
    return new;
  end if;

  insert into public.cash_ledger(
    shift_id,cashier_id,outlet_id,direction,amount,reason,source_type,source_id
  ) values (
    v_shift_id,v_cashier_id,v_outlet_id,'in',v_net,'Penjualan tunai','payment',new.id
  );

  return new;
end;
$$;
