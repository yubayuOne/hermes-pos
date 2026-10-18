-- KASBOX: fix PL/pgSQL variable/column ambiguity in transaction RPCs.
-- Safe to run on databases that already applied 001_initial.sql.
-- The function signatures remain unchanged, so the mobile app does not need a code change.

create or replace function public.save_held_bill(p_shift_id uuid,p_cashier_id uuid,p_outlet_id uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  tid uuid;
  it jsonb;
  pid uuid;
  qty numeric;
  phpp numeric;
  pprice numeric;
  v_total numeric := 0;
  v_thpp numeric := 0;
begin
  perform public.assert_cashier(p_cashier_id,p_outlet_id);

  if not exists(
    select 1
    from shifts
    where id=p_shift_id
      and cashier_id=p_cashier_id
      and status='open'
  ) then
    raise exception 'Shift aktif tidak ditemukan';
  end if;

  insert into transactions(
    shift_id,cashier_id,outlet_id,number,
    customer_name,customer_phone,table_number,status
  )
  values(
    p_shift_id,p_cashier_id,p_outlet_id,next_transaction_number(),
    coalesce(p_payload->>'customer_name',''),
    coalesce(p_payload->>'customer_phone',''),
    coalesce(p_payload->>'table_number',''),
    'held'
  )
  returning id into tid;

  for it in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    pid := (it->>'product_id')::uuid;
    qty := (it->>'quantity')::numeric;

    if qty <= 0 then
      raise exception 'Kuantitas tidak valid';
    end if;

    select p.hpp,p.selling_price
      into phpp,pprice
      from products p
      where p.id=pid
        and p.outlet_id=p_outlet_id
        and p.is_active
      for share;

    if not found then
      raise exception 'Produk tidak ditemukan';
    end if;

    insert into transaction_items(
      transaction_id,product_id,quantity,hpp_unit,selling_price_unit
    )
    values(tid,pid,qty,phpp,pprice);

    v_total := v_total + (qty * pprice);
    v_thpp := v_thpp + (qty * phpp);
  end loop;

  if v_total <= 0 then
    raise exception 'Bill kosong';
  end if;

  update transactions t
  set subtotal=v_total,
      total=v_total,
      total_hpp=v_thpp
  where t.id=tid;

  insert into held_bills(transaction_id) values(tid);

  return tid;
end $$;

create or replace function public.complete_checkout(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_payload jsonb,
  p_payment_method public.payment_method,
  p_amount_received numeric,
  p_external_reference text,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  tid uuid;
  existing_tid uuid;
  it jsonb;
  pid uuid;
  qty numeric;
  phpp numeric;
  pprice numeric;
  stock numeric;
  v_total numeric := 0;
  v_thpp numeric := 0;
  v_change numeric := 0;
  tnumber text;
begin
  perform public.assert_cashier(p_cashier_id,p_outlet_id);

  select ci.transaction_id
    into existing_tid
    from checkout_idempotency ci
    where ci.cashier_id=p_cashier_id
      and ci.idempotency_key=p_idempotency_key;

  if existing_tid is not null then
    select t.number,t.total
      into tnumber,v_total
      from transactions t
      where t.id=existing_tid;

    select p.change_amount
      into v_change
      from payments p
      where p.transaction_id=existing_tid;

    return jsonb_build_object(
      'transactionId',existing_tid,
      'transactionNumber',tnumber,
      'total',v_total,
      'change',v_change
    );
  end if;

  if not exists(
    select 1
    from shifts s
    where s.id=p_shift_id
      and s.cashier_id=p_cashier_id
      and s.outlet_id=p_outlet_id
      and s.status='open'
  ) then
    raise exception 'Shift aktif tidak ditemukan';
  end if;

  insert into transactions(
    shift_id,cashier_id,outlet_id,number,
    customer_name,customer_phone,table_number,status
  )
  values(
    p_shift_id,p_cashier_id,p_outlet_id,next_transaction_number(),
    coalesce(p_payload->>'customer_name',''),
    coalesce(p_payload->>'customer_phone',''),
    coalesce(p_payload->>'table_number',''),
    'draft'
  )
  returning id,number into tid,tnumber;

  for it in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    pid := (it->>'product_id')::uuid;
    qty := (it->>'quantity')::numeric;

    if qty <= 0 then
      raise exception 'Kuantitas tidak valid';
    end if;

    select p.hpp,p.selling_price,p.stock
      into phpp,pprice,stock
      from products p
      where p.id=pid
        and p.outlet_id=p_outlet_id
        and p.is_active
      for update;

    if not found then
      raise exception 'Produk tidak ditemukan';
    end if;

    if stock < qty then
      raise exception 'Stok produk tidak mencukupi';
    end if;

    insert into transaction_items(
      transaction_id,product_id,quantity,hpp_unit,selling_price_unit
    )
    values(tid,pid,qty,phpp,pprice);

    v_total := v_total + (qty * pprice);
    v_thpp := v_thpp + (qty * phpp);

    update products p
    set stock=p.stock-qty
    where p.id=pid;
  end loop;

  if v_total <= 0 then
    raise exception 'Bill kosong';
  end if;

  if p_payment_method='cash' then
    if p_amount_received < v_total then
      raise exception 'Uang diterima kurang';
    end if;

    v_change := p_amount_received-v_total;
  else
    p_amount_received := v_total;
    v_change := 0;
  end if;

  update transactions t
  set subtotal=v_total,
      total=v_total,
      total_hpp=v_thpp,
      status='completed',
      payment_method=p_payment_method,
      completed_at=now()
  where t.id=tid;

  insert into payments(
    transaction_id,method,amount_received,change_amount,
    external_reference,status
  )
  values(
    tid,p_payment_method,p_amount_received,v_change,
    p_external_reference,'paid'
  );

  insert into checkout_idempotency(
    idempotency_key,cashier_id,transaction_id
  )
  values(p_idempotency_key,p_cashier_id,tid);

  return jsonb_build_object(
    'transactionId',tid,
    'transactionNumber',tnumber,
    'total',v_total,
    'change',v_change
  );

exception
  when unique_violation then
    select ci.transaction_id
      into existing_tid
      from checkout_idempotency ci
      where ci.cashier_id=p_cashier_id
        and ci.idempotency_key=p_idempotency_key;

    if existing_tid is not null then
      select t.number,t.total
        into tnumber,v_total
        from transactions t
        where t.id=existing_tid;

      select p.change_amount
        into v_change
        from payments p
        where p.transaction_id=existing_tid;

      return jsonb_build_object(
        'transactionId',existing_tid,
        'transactionNumber',tnumber,
        'total',v_total,
        'change',v_change
      );
    end if;

    raise;
end $$;

