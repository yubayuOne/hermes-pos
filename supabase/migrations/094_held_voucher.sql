-- A held bill keeps the voucher the cashier applied (owner's report, 4 Nov 2026): the code is saved with the bill and
-- sent back on recall, so the voucher is not lost. save_held_bill, update_held_bill and recall_held_bill are copies of
-- 025, 032 and 023 with only this column added.

alter table public.transactions add column if not exists held_voucher_code text;

create or replace function public.save_held_bill(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_payload jsonb,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  tid uuid;
  it jsonb;
  pid uuid;
  qty numeric;
  phpp numeric;
  pprice numeric;
  v_gross numeric := 0;
  v_idisc numeric := 0;
  v_thpp numeric := 0;
  v_gline numeric;
  v_d numeric;
  v_key text;
begin
  perform public.assert_open_shift(p_shift_id, p_cashier_id, p_outlet_id);

  if coalesce(btrim(p_idempotency_key), '') <> '' then
    v_key := 'hold:' || btrim(p_idempotency_key);
    perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
    select ci.transaction_id into tid
    from public.checkout_idempotency ci
    where ci.cashier_id = p_cashier_id and ci.idempotency_key = v_key;
    if tid is not null then return tid; end if;
  end if;

  insert into public.transactions(
    shift_id,cashier_id,outlet_id,number,
    customer_name,customer_phone,table_number,status,held_voucher_code
  )
  values(
    p_shift_id,p_cashier_id,p_outlet_id,public.next_transaction_number(),
    coalesce(p_payload->>'customer_name',''),
    coalesce(p_payload->>'customer_phone',''),
    coalesce(p_payload->>'table_number',''),
    'held',
    nullif(btrim(p_payload->>'voucher_code'),'')
  )
  returning id into tid;

  for it in
    select jsonb_build_object(
      'product_id', value->>'product_id',
      'quantity', sum((value->>'quantity')::numeric),
      'discount_type', (array_agg(value->>'discount_type'))[1],
      'discount_value', max(coalesce((value->>'discount_value')::numeric, 0)),
      'note', max(nullif(btrim(value->>'note'),''))
    ) as it
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb))
    group by value->>'product_id'
    order by value->>'product_id'
  loop
    pid := (it->>'product_id')::uuid;
    qty := (it->>'quantity')::numeric;
    if qty <= 0 then raise exception 'Kuantitas tidak valid'; end if;

    select p.hpp,p.selling_price into phpp,pprice
    from public.products p
    where p.id=pid and p.outlet_id=p_outlet_id and p.is_active;
    if not found then raise exception 'Produk tidak ditemukan'; end if;

    v_gline := qty * pprice;
    v_d := public.calc_discount(v_gline, it->>'discount_type', (it->>'discount_value')::numeric);

    insert into public.transaction_items(
      transaction_id,product_id,quantity,hpp_unit,selling_price_unit,
      discount_amount,discount_type,discount_value,note
    ) values(
      tid,pid,qty,phpp,pprice,
      v_d,
      case when v_d > 0 then it->>'discount_type' else null end,
      case when v_d > 0 then (it->>'discount_value')::numeric else null end,
      left(it->>'note',200)
    );

    v_gross := v_gross + v_gline;
    v_idisc := v_idisc + v_d;
    v_thpp := v_thpp + qty*phpp;
  end loop;

  perform public.set_bill_totals(
    tid, v_gross, v_idisc,
    p_payload->>'bill_discount_type', (p_payload->>'bill_discount_value')::numeric
  );
  update public.transactions set total_hpp = v_thpp where id = tid;

  insert into public.held_bills(transaction_id) values(tid);

  if v_key is not null then
    insert into public.checkout_idempotency(idempotency_key,cashier_id,transaction_id,request_hash)
    values(v_key, p_cashier_id, tid, md5(coalesce(p_payload,'{}'::jsonb)::text));
  end if;

  return tid;
end;
$$;

create or replace function public.update_held_bill(p_transaction_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t public.transactions%rowtype;
  it jsonb;
  pid uuid;
  qty numeric;
  phpp numeric;
  pprice numeric;
  v_gross numeric := 0;
  v_idisc numeric := 0;
  v_thpp numeric := 0;
  v_gline numeric;
  v_d numeric;
begin
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id, t.outlet_id);
  if t.status <> 'held' then raise exception 'Hanya Bill Ditahan yang dapat diubah'; end if;
  perform public.assert_open_shift(t.shift_id, t.cashier_id, t.outlet_id);
  if exists (select 1 from public.transactions c where c.parent_transaction_id = t.id) then
    raise exception 'Bill ini sudah dibayar sebagian lewat pisah bill. Bayar sisanya lewat Pisah bill.' using errcode = 'P0001', hint = 'held_split_started';
  end if;
  if jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) = 0 then raise exception 'Bill kosong'; end if;

  delete from public.transaction_items where transaction_id = t.id;
  for it in
    select jsonb_build_object(
      'product_id', value->>'product_id',
      'quantity', sum((value->>'quantity')::numeric),
      'discount_type', (array_agg(value->>'discount_type'))[1],
      'discount_value', max(coalesce((value->>'discount_value')::numeric, 0)),
      'note', max(nullif(btrim(value->>'note'), ''))
    ) as it
    from jsonb_array_elements(p_payload->'items')
    group by value->>'product_id'
    order by value->>'product_id'
  loop
    pid := (it->>'product_id')::uuid;
    qty := (it->>'quantity')::numeric;
    if qty <= 0 then raise exception 'Kuantitas tidak valid'; end if;
    select p.hpp, p.selling_price into phpp, pprice from public.products p where p.id = pid and p.outlet_id = t.outlet_id and p.is_active;
    if not found then raise exception 'Produk tidak ditemukan'; end if;
    v_gline := qty * pprice;
    v_d := public.calc_discount(v_gline, it->>'discount_type', (it->>'discount_value')::numeric);
    insert into public.transaction_items(transaction_id, product_id, quantity, hpp_unit, selling_price_unit, discount_amount, discount_type, discount_value, note)
    values (t.id, pid, qty, phpp, pprice, v_d,
      case when v_d > 0 then it->>'discount_type' end, case when v_d > 0 then (it->>'discount_value')::numeric end, left(it->>'note', 200));
    v_gross := v_gross + v_gline;
    v_idisc := v_idisc + v_d;
    v_thpp := v_thpp + qty * phpp;
  end loop;

  update public.transactions set
    customer_name = coalesce(p_payload->>'customer_name', customer_name),
    customer_phone = coalesce(p_payload->>'customer_phone', customer_phone),
    table_number = coalesce(p_payload->>'table_number', table_number),
    held_voucher_code = nullif(btrim(p_payload->>'voucher_code'),''),
    total_hpp = v_thpp
  where id = t.id;
  perform public.set_bill_totals(t.id, v_gross, v_idisc, p_payload->>'bill_discount_type', (p_payload->>'bill_discount_value')::numeric);
  return t.id;
end $$;

create or replace function public.recall_held_bill(p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t transactions%rowtype;
begin
  select * into t from transactions where id=p_transaction_id for update;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id,t.outlet_id);
  if t.status not in ('held','split') then raise exception 'Bill tidak berstatus ditahan'; end if;
  return jsonb_build_object(
    'transactionId',t.id,'number',t.number,
    'customerName',t.customer_name,'customerPhone',t.customer_phone,'tableNumber',t.table_number,
    'billDiscountType',t.bill_discount_type,'billDiscountValue',t.bill_discount_value,
    'voucherCode',t.held_voucher_code
  );
end $$;
