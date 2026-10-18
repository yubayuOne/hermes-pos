-- KASBOX Held Bill + Split Bill Hardening
-- 1) Normalize duplicate product lines when creating a held bill.
-- 2) Pay existing held bills using aggregated stored quantities.
-- 3) Preserve historical HPP/price snapshots from the held transaction.
-- 4) Keep split allocation based on aggregate parent quantities.

create or replace function public.save_held_bill(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_payload jsonb
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
  v_total numeric := 0;
  v_thpp numeric := 0;
begin
  perform public.assert_open_shift(p_shift_id, p_cashier_id, p_outlet_id);

  insert into public.transactions(
    shift_id,cashier_id,outlet_id,number,
    customer_name,customer_phone,table_number,status
  )
  values(
    p_shift_id,p_cashier_id,p_outlet_id,public.next_transaction_number(),
    coalesce(p_payload->>'customer_name',''),
    coalesce(p_payload->>'customer_phone',''),
    coalesce(p_payload->>'table_number',''),
    'held'
  )
  returning id into tid;

  -- Aggregate duplicate product lines before snapshotting the bill.
  for it in
    select jsonb_build_object(
      'product_id', value->>'product_id',
      'quantity', sum((value->>'quantity')::numeric)
    ) as it
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb))
    group by value->>'product_id'
    order by value->>'product_id'
  loop
    pid := (it->>'product_id')::uuid;
    qty := (it->>'quantity')::numeric;

    if qty <= 0 then
      raise exception 'Kuantitas tidak valid';
    end if;

    select p.hpp,p.selling_price
      into phpp,pprice
    from public.products p
    where p.id=pid
      and p.outlet_id=p_outlet_id
      and p.is_active;

    if not found then
      raise exception 'Produk tidak ditemukan';
    end if;

    insert into public.transaction_items(
      transaction_id,product_id,quantity,hpp_unit,selling_price_unit
    ) values(tid,pid,qty,phpp,pprice);

    v_total := v_total + qty*pprice;
    v_thpp := v_thpp + qty*phpp;
  end loop;

  if v_total <= 0 then
    raise exception 'Bill kosong';
  end if;

  update public.transactions
  set subtotal=v_total,total=v_total,total_hpp=v_thpp
  where id=tid;

  insert into public.held_bills(transaction_id) values(tid);

  return tid;
end;
$$;

grant execute on function public.save_held_bill(uuid, uuid, uuid, jsonb) to authenticated;

-- Re-apply complete_checkout with the same hardened signature. This version
-- aggregates duplicate lines from an existing held transaction before stock
-- validation/payment, so older held bills cannot bypass quantity checks.
create or replace function public.complete_checkout(
  p_shift_id uuid,
  p_cashier_id uuid,
  p_outlet_id uuid,
  p_payload jsonb,
  p_payment_method public.payment_method,
  p_amount_received numeric,
  p_external_reference text,
  p_idempotency_key text,
  p_parent_transaction_id uuid default null,
  p_existing_transaction_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  tid uuid;
  existing_tid uuid;
  target_tx transactions%rowtype;
  parent_tx transactions%rowtype;
  it jsonb;
  pid uuid;
  qty numeric;
  phpp numeric;
  pprice numeric;
  stock numeric;
  parent_qty numeric;
  allocated_qty numeric;
  v_total numeric := 0;
  v_thpp numeric := 0;
  v_change numeric := 0;
  tnumber text;
  remaining numeric;
  stored_qty numeric;
  stored_hpp numeric;
  stored_price numeric;
  request_hash text;
  stored_request_hash text;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);

  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'ID pembayaran tidak valid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  request_hash := md5(jsonb_build_object(
    'shift_id', p_shift_id,
    'cashier_id', p_cashier_id,
    'outlet_id', p_outlet_id,
    'payload', coalesce(p_payload, '{}'::jsonb),
    'payment_method', p_payment_method::text,
    'amount_received', p_amount_received,
    'external_reference', p_external_reference,
    'parent_transaction_id', p_parent_transaction_id,
    'existing_transaction_id', p_existing_transaction_id
  )::text);

  select ci.transaction_id, ci.request_hash
    into existing_tid, stored_request_hash
  from checkout_idempotency ci
  where ci.cashier_id=p_cashier_id
    and ci.idempotency_key=p_idempotency_key;

  if existing_tid is not null then
    if stored_request_hash is not null and stored_request_hash <> request_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST';
    end if;

    select t.number,t.total into tnumber,v_total
    from transactions t where t.id=existing_tid;

    select p.change_amount into v_change
    from payments p where p.transaction_id=existing_tid;

    return jsonb_build_object(
      'transactionId',existing_tid,
      'transactionNumber',tnumber,
      'total',v_total,
      'change',v_change
    );
  end if;

  perform public.assert_open_shift(p_shift_id,p_cashier_id,p_outlet_id);

  --------------------------------------------------------------------------
  -- Existing held/draft bill. The database owns its item snapshot.
  --------------------------------------------------------------------------
  if p_existing_transaction_id is not null then
    select * into target_tx
    from transactions
    where id=p_existing_transaction_id
    for update;

    if not found then raise exception 'Bill tidak ditemukan'; end if;
    if target_tx.shift_id<>p_shift_id
       or target_tx.cashier_id<>p_cashier_id
       or target_tx.outlet_id<>p_outlet_id then
      raise exception 'Bill tidak sesuai dengan sesi kasir';
    end if;
    if target_tx.status not in ('held','draft') then
      raise exception 'Bill tidak dapat dibayar';
    end if;

    tid:=target_tx.id;
    tnumber:=target_tx.number;

    -- The payload is the cashier's CURRENT cart. After recalling a held bill,
    -- it can contain the original held quantity plus newly added products.
    -- Reconcile the stored snapshot with that desired cart before payment.
    create temporary table if not exists pg_temp.tmp_existing_lines (
      product_id uuid primary key,
      quantity numeric not null,
      hpp_unit numeric not null,
      selling_price_unit numeric not null
    ) on commit drop;
    truncate pg_temp.tmp_existing_lines;

    insert into pg_temp.tmp_existing_lines(product_id,quantity,hpp_unit,selling_price_unit)
    select ti.product_id,sum(ti.quantity),min(ti.hpp_unit),min(ti.selling_price_unit)
    from transaction_items ti
    where ti.transaction_id=tid
    group by ti.product_id;

    create temporary table if not exists pg_temp.tmp_desired_lines (
      product_id uuid primary key,
      quantity numeric not null
    ) on commit drop;
    truncate pg_temp.tmp_desired_lines;

    insert into pg_temp.tmp_desired_lines(product_id,quantity)
    select (value->>'product_id')::uuid,sum((value->>'quantity')::numeric)
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb))
    group by (value->>'product_id')::uuid;

    if not exists(select 1 from pg_temp.tmp_desired_lines where quantity>0) then
      raise exception 'Bill kosong';
    end if;

    -- Rebuild the transaction snapshot from the desired cart. This is safe
    -- because the original held bill has not reserved/consumed stock.
    delete from transaction_items where transaction_id=tid;

    -- Lock all final products in deterministic order to avoid checkout races.
    for pid,qty in
      select d.product_id,d.quantity
      from pg_temp.tmp_desired_lines d
      where d.quantity>0
      order by d.product_id
    loop
      select p.stock,p.hpp,p.selling_price
        into stock,phpp,pprice
      from products p
      where p.id=pid
        and p.outlet_id=p_outlet_id
        and p.is_active
      for update;

      if not found then raise exception 'Produk pada Bill tidak ditemukan atau sudah tidak aktif'; end if;
      if stock<qty then raise exception 'Stok produk tidak mencukupi'; end if;

      select e.quantity,e.hpp_unit,e.selling_price_unit
        into stored_qty,stored_hpp,stored_price
      from pg_temp.tmp_existing_lines e
      where e.product_id=pid;

      if not found then
        stored_qty:=0;
        stored_hpp:=phpp;
        stored_price:=pprice;
      end if;

      -- Quantity that was already held keeps its historical price/HPP.
      if qty<=stored_qty then
        insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit)
        values(tid,pid,qty,stored_hpp,stored_price);
        v_total:=v_total+qty*stored_price;
        v_thpp:=v_thpp+qty*stored_hpp;
      else
        if stored_qty>0 then
          insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit)
          values(tid,pid,stored_qty,stored_hpp,stored_price);
          v_total:=v_total+stored_qty*stored_price;
          v_thpp:=v_thpp+stored_qty*stored_hpp;
        end if;

        -- Newly added quantity gets the current catalog snapshot.
        insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit)
        values(tid,pid,qty-stored_qty,phpp,pprice);
        v_total:=v_total+(qty-stored_qty)*pprice;
        v_thpp:=v_thpp+(qty-stored_qty)*phpp;
      end if;

      update products p set stock=p.stock-qty where p.id=pid;
    end loop;

    update transactions
    set customer_name=coalesce(p_payload->>'customer_name',target_tx.customer_name),
        customer_phone=coalesce(p_payload->>'customer_phone',target_tx.customer_phone),
        table_number=coalesce(p_payload->>'table_number',target_tx.table_number)
    where id=tid;

    if v_total<=0 then raise exception 'Bill kosong'; end if;

    if p_payment_method='cash' then
      if p_amount_received<v_total then raise exception 'Uang diterima kurang'; end if;
      v_change:=p_amount_received-v_total;
    else
      p_amount_received:=v_total;
      v_change:=0;
    end if;

    update transactions
    set subtotal=v_total,total=v_total,total_hpp=v_thpp,
        status='completed',payment_method=p_payment_method,completed_at=now()
    where id=tid;

    delete from held_bills where transaction_id=tid;

    insert into payments(
      transaction_id,method,amount_received,change_amount,external_reference,status
    ) values(
      tid,p_payment_method,p_amount_received,v_change,p_external_reference,'paid'
    );

    insert into checkout_idempotency(idempotency_key,cashier_id,transaction_id,request_hash)
    values(p_idempotency_key,p_cashier_id,tid,request_hash);

    return jsonb_build_object('transactionId',tid,'transactionNumber',tnumber,'total',v_total,'change',v_change);
  end if;

  --------------------------------------------------------------------------
  -- Split child checkout.
  --------------------------------------------------------------------------
  if p_parent_transaction_id is not null then
    select * into parent_tx
    from transactions
    where id=p_parent_transaction_id
    for update;

    if not found then raise exception 'Parent Split Bill tidak ditemukan'; end if;
    if parent_tx.status not in ('held','split') then raise exception 'Split Bill sudah tidak aktif'; end if;
    if parent_tx.shift_id<>p_shift_id
       or parent_tx.cashier_id<>p_cashier_id
       or parent_tx.outlet_id<>p_outlet_id then
      raise exception 'Split Bill tidak sesuai dengan sesi kasir';
    end if;
  end if;

  insert into transactions(
    shift_id,cashier_id,outlet_id,number,
    customer_name,customer_phone,table_number,status,parent_transaction_id
  ) values(
    p_shift_id,p_cashier_id,p_outlet_id,next_transaction_number(),
    coalesce(p_payload->>'customer_name',''),
    coalesce(p_payload->>'customer_phone',''),
    coalesce(p_payload->>'table_number',''),
    'draft',p_parent_transaction_id
  ) returning id,number into tid,tnumber;

  for it in
    select jsonb_build_object(
      'product_id',value->>'product_id',
      'quantity',sum((value->>'quantity')::numeric)
    ) as it
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb))
    group by value->>'product_id'
    order by value->>'product_id'
  loop
    pid:=(it->>'product_id')::uuid;
    qty:=(it->>'quantity')::numeric;
    if qty<=0 then raise exception 'Kuantitas tidak valid'; end if;

    if p_parent_transaction_id is not null then
      select coalesce(sum(ti.quantity),0) into parent_qty
      from transaction_items ti
      where ti.transaction_id=p_parent_transaction_id and ti.product_id=pid;

      if parent_qty<=0 then raise exception 'Produk tidak tersedia pada Split Bill'; end if;

      select coalesce(sum(child_item.quantity),0) into allocated_qty
      from transaction_items child_item
      join transactions child_tx on child_tx.id=child_item.transaction_id
      where child_tx.parent_transaction_id=p_parent_transaction_id
        and child_tx.status='completed'
        and child_item.product_id=pid;

      if allocated_qty+qty>parent_qty then
        raise exception 'Jumlah produk pada Split Bill melebihi pesanan awal';
      end if;

      select min(ti.hpp_unit),min(ti.selling_price_unit)
        into phpp,pprice
      from transaction_items ti
      where ti.transaction_id=p_parent_transaction_id
        and ti.product_id=pid;
    else
      select p.hpp,p.selling_price into phpp,pprice
      from products p
      where p.id=pid and p.outlet_id=p_outlet_id and p.is_active;
      if not found then raise exception 'Produk tidak ditemukan'; end if;
    end if;

    select p.stock into stock
    from products p
    where p.id=pid and p.outlet_id=p_outlet_id and p.is_active
    for update;

    if not found then raise exception 'Produk tidak ditemukan'; end if;
    if stock<qty then raise exception 'Stok produk tidak mencukupi'; end if;

    insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit)
    values(tid,pid,qty,phpp,pprice);

    v_total:=v_total+qty*pprice;
    v_thpp:=v_thpp+qty*phpp;
    update products p set stock=p.stock-qty where p.id=pid;
  end loop;

  if v_total<=0 then raise exception 'Bill kosong'; end if;

  if p_payment_method='cash' then
    if p_amount_received<v_total then raise exception 'Uang diterima kurang'; end if;
    v_change:=p_amount_received-v_total;
  else
    p_amount_received:=v_total;
    v_change:=0;
  end if;

  update transactions
  set subtotal=v_total,total=v_total,total_hpp=v_thpp,
      status='completed',payment_method=p_payment_method,completed_at=now()
  where id=tid;

  insert into payments(
    transaction_id,method,amount_received,change_amount,external_reference,status
  ) values(
    tid,p_payment_method,p_amount_received,v_change,p_external_reference,'paid'
  );

  insert into checkout_idempotency(idempotency_key,cashier_id,transaction_id,request_hash)
  values(p_idempotency_key,p_cashier_id,tid,request_hash);

  if p_parent_transaction_id is not null then
    select count(*) into remaining
    from (
      select parent_item.product_id,
             sum(parent_item.quantity) as parent_qty,
             coalesce((
               select sum(child_item.quantity)
               from transaction_items child_item
               join transactions child_tx on child_tx.id=child_item.transaction_id
               where child_tx.parent_transaction_id=p_parent_transaction_id
                 and child_tx.status='completed'
                 and child_item.product_id=parent_item.product_id
             ),0) as allocated_qty
      from transaction_items parent_item
      where parent_item.transaction_id=p_parent_transaction_id
      group by parent_item.product_id
    ) remaining_by_product
    where remaining_by_product.parent_qty > remaining_by_product.allocated_qty;

    if remaining=0 then
      update transactions set status='cancelled' where id=p_parent_transaction_id;
      delete from held_bills where transaction_id=p_parent_transaction_id;
    else
      update transactions set status='held' where id=p_parent_transaction_id;
    end if;
  end if;

  return jsonb_build_object('transactionId',tid,'transactionNumber',tnumber,'total',v_total,'change',v_change);

exception
  when unique_violation then
    select ci.transaction_id,ci.request_hash into existing_tid,stored_request_hash
    from checkout_idempotency ci
    where ci.cashier_id=p_cashier_id and ci.idempotency_key=p_idempotency_key;

    if existing_tid is not null then
      if stored_request_hash is not null and stored_request_hash<>request_hash then
        raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST';
      end if;
      select t.number,t.total into tnumber,v_total from transactions t where t.id=existing_tid;
      select p.change_amount into v_change from payments p where p.transaction_id=existing_tid;
      return jsonb_build_object('transactionId',existing_tid,'transactionNumber',tnumber,'total',v_total,'change',v_change);
    end if;
    raise;
end;
$$;

grant execute on function public.complete_checkout(uuid,uuid,uuid,jsonb,public.payment_method,numeric,text,text,uuid,uuid) to authenticated;
