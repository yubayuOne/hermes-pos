-- A discount may take the total to zero (owner's decision, 4 Nov 2026): a free bill is still a sale. set_bill_totals
-- no longer refuses a zero total. The rest of 023 is unchanged; empty bills are still refused ('Bill kosong').

create or replace function public.set_bill_totals(
  p_transaction_id uuid,
  p_gross numeric,
  p_item_discount numeric,
  p_bill_type text,
  p_bill_value numeric
)
returns numeric
language plpgsql
security definer
set search_path=public
as $$
declare
  v_base numeric := p_gross - p_item_discount;
  v_bd numeric;
  v_total numeric;
begin
  if p_gross <= 0 then raise exception 'Bill kosong'; end if;
  v_bd := public.calc_discount(v_base, p_bill_type, p_bill_value);
  v_total := v_base - v_bd;

  update public.transactions
  set subtotal = p_gross,
      item_discount = p_item_discount,
      bill_discount = v_bd,
      bill_discount_type = case when v_bd > 0 then p_bill_type else null end,
      bill_discount_value = case when v_bd > 0 then p_bill_value else null end,
      total = v_total
  where id = p_transaction_id;

  return v_total;
end $$;
