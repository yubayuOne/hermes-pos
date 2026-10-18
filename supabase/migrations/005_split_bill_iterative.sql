-- KASBOX iterative split bill
-- Parent remains the held master bill while child bills are paid one by one.
-- The parent is only finalized internally after all original quantities are allocated.

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
begin
  perform public.assert_cashier(p_cashier_id,p_outlet_id);

  select ci.transaction_id into existing_tid
  from checkout_idempotency ci
  where ci.cashier_id=p_cashier_id
    and ci.idempotency_key=p_idempotency_key;

  if existing_tid is not null then
    select t.number,t.total into tnumber,v_total from transactions t where t.id=existing_tid;
    select p.change_amount into v_change from payments p where p.transaction_id=existing_tid limit 1;
    return jsonb_build_object('transactionId',existing_tid,'transactionNumber',tnumber,'total',v_total,'change',v_change);
  end if;

  if not exists(select 1 from shifts s where s.id=p_shift_id and s.cashier_id=p_cashier_id and s.outlet_id=p_outlet_id and s.status='open') then
    raise exception 'Shift aktif tidak ditemukan';
  end if;

  if p_existing_transaction_id is not null then
    select * into target_tx from transactions where id=p_existing_transaction_id for update;
    if not found then raise exception 'Bill tidak ditemukan'; end if;
    if target_tx.shift_id<>p_shift_id or target_tx.cashier_id<>p_cashier_id or target_tx.outlet_id<>p_outlet_id then raise exception 'Bill tidak sesuai dengan sesi kasir'; end if;
    if target_tx.status not in ('held','draft') then raise exception 'Bill tidak dapat dibayar'; end if;

    tid := target_tx.id;
    tnumber := target_tx.number;

    for it in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
      pid := (it->>'product_id')::uuid;
      qty := (it->>'quantity')::numeric;
      if qty <= 0 then raise exception 'Kuantitas tidak valid'; end if;
      select p.hpp,p.selling_price,p.stock into phpp,pprice,stock from products p where p.id=pid and p.outlet_id=p_outlet_id and p.is_active for update;
      if not found then raise exception 'Produk tidak ditemukan'; end if;
      if stock < qty then raise exception 'Stok produk tidak mencukupi'; end if;
      v_total := v_total + qty*pprice;
      v_thpp := v_thpp + qty*phpp;
      update products set stock=products.stock-qty where id=pid;
    end loop;

    if v_total <= 0 then raise exception 'Bill kosong'; end if;
    if p_payment_method='cash' then
      if p_amount_received < v_total then raise exception 'Uang diterima kurang'; end if;
      v_change := p_amount_received-v_total;
    else
      p_amount_received := v_total;
      v_change := 0;
    end if;

    update transactions set subtotal=v_total,total=v_total,total_hpp=v_thpp,status='completed',payment_method=p_payment_method,completed_at=now() where id=tid;
    delete from held_bills where transaction_id=tid;
    insert into payments(transaction_id,method,amount_received,change_amount,external_reference,status) values(tid,p_payment_method,p_amount_received,v_change,p_external_reference,'paid');
    insert into checkout_idempotency(idempotency_key,cashier_id,transaction_id) values(p_idempotency_key,p_cashier_id,tid);
    return jsonb_build_object('transactionId',tid,'transactionNumber',tnumber,'total',v_total,'change',v_change);
  end if;

  if p_parent_transaction_id is not null then
    select * into parent_tx from transactions where id=p_parent_transaction_id for update;
    if not found then raise exception 'Parent Split Bill tidak ditemukan'; end if;
    if parent_tx.status not in ('held','split') then raise exception 'Split Bill sudah tidak aktif'; end if;
    if parent_tx.shift_id<>p_shift_id or parent_tx.cashier_id<>p_cashier_id or parent_tx.outlet_id<>p_outlet_id then raise exception 'Split Bill tidak sesuai dengan sesi kasir'; end if;
  end if;

  insert into transactions(shift_id,cashier_id,outlet_id,number,customer_name,customer_phone,table_number,status,parent_transaction_id)
  values(p_shift_id,p_cashier_id,p_outlet_id,next_transaction_number(),coalesce(p_payload->>'customer_name',''),coalesce(p_payload->>'customer_phone',''),coalesce(p_payload->>'table_number',''),'draft',p_parent_transaction_id)
  returning id,number into tid,tnumber;

  for it in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    pid := (it->>'product_id')::uuid;
    qty := (it->>'quantity')::numeric;
    if qty <= 0 then raise exception 'Kuantitas tidak valid'; end if;

    if p_parent_transaction_id is not null then
      select coalesce(sum(ti.quantity),0) into parent_qty from transaction_items ti where ti.transaction_id=p_parent_transaction_id and ti.product_id=pid;
      if parent_qty<=0 then raise exception 'Produk tidak tersedia pada Split Bill'; end if;
      select coalesce(sum(child_item.quantity),0) into allocated_qty
      from transaction_items child_item join transactions child_tx on child_tx.id=child_item.transaction_id
      where child_tx.parent_transaction_id=p_parent_transaction_id and child_tx.status='completed' and child_item.product_id=pid;
      if allocated_qty+qty>parent_qty then raise exception 'Jumlah produk pada Split Bill melebihi pesanan awal'; end if;
    end if;

    select p.hpp,p.selling_price,p.stock into phpp,pprice,stock from products p where p.id=pid and p.outlet_id=p_outlet_id and p.is_active for update;
    if not found then raise exception 'Produk tidak ditemukan'; end if;
    if stock<qty then raise exception 'Stok produk tidak mencukupi'; end if;
    insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit) values(tid,pid,qty,phpp,pprice);
    v_total := v_total + qty*pprice;
    v_thpp := v_thpp + qty*phpp;
    update products set stock=products.stock-qty where id=pid;
  end loop;

  if v_total<=0 then raise exception 'Bill kosong'; end if;
  if p_payment_method='cash' then
    if p_amount_received<v_total then raise exception 'Uang diterima kurang'; end if;
    v_change:=p_amount_received-v_total;
  else
    p_amount_received:=v_total;
    v_change:=0;
  end if;

  update transactions set subtotal=v_total,total=v_total,total_hpp=v_thpp,status='completed',payment_method=p_payment_method,completed_at=now() where id=tid;
  insert into payments(transaction_id,method,amount_received,change_amount,external_reference,status) values(tid,p_payment_method,p_amount_received,v_change,p_external_reference,'paid');
  insert into checkout_idempotency(idempotency_key,cashier_id,transaction_id) values(p_idempotency_key,p_cashier_id,tid);

  if p_parent_transaction_id is not null then
    select count(*) into remaining
    from transaction_items parent_item
    where parent_item.transaction_id=p_parent_transaction_id
      and parent_item.quantity > (
        select coalesce(sum(child_item.quantity),0)
        from transaction_items child_item
        join transactions child_tx on child_tx.id=child_item.transaction_id
        where child_tx.parent_transaction_id=p_parent_transaction_id
          and child_tx.status='completed'
          and child_item.product_id=parent_item.product_id
      );
    if remaining=0 then
      update transactions set status='cancelled' where id=p_parent_transaction_id;
      delete from held_bills where transaction_id=p_parent_transaction_id;
    else
      update transactions set status='held' where id=p_parent_transaction_id;
    end if;
  end if;

  return jsonb_build_object('transactionId',tid,'transactionNumber',tnumber,'total',v_total,'change',v_change);
exception when unique_violation then
  select ci.transaction_id into existing_tid from checkout_idempotency ci where ci.cashier_id=p_cashier_id and ci.idempotency_key=p_idempotency_key;
  if existing_tid is not null then
    select t.number,t.total into tnumber,v_total from transactions t where t.id=existing_tid;
    select p.change_amount into v_change from payments p where p.transaction_id=existing_tid limit 1;
    return jsonb_build_object('transactionId',existing_tid,'transactionNumber',tnumber,'total',v_total,'change',v_change);
  end if;
  raise;
end;
$$;

grant execute on function public.complete_checkout(uuid,uuid,uuid,jsonb,public.payment_method,numeric,text,text,uuid,uuid) to authenticated;

create or replace function public.start_split_from_held(p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t transactions%rowtype;
begin
  select * into t from transactions where id=p_transaction_id for update;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id,t.outlet_id);
  if t.status not in ('held','split') then raise exception 'Bill tidak dapat digunakan untuk Split Bill'; end if;
  if t.status='held' then
    update transactions set status='held' where id=t.id;
  end if;
  return jsonb_build_object('transactionId',t.id,'number',t.number,'customerName',t.customer_name,'customerPhone',t.customer_phone,'tableNumber',t.table_number);
end $$;
grant execute on function public.start_split_from_held(uuid) to authenticated;

-- Direct recall keeps the original held master intact. Normal payment can complete it,
-- while Split Bill can allocate child bills against the same master.
create or replace function public.recall_held_bill(p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t transactions%rowtype;
begin
  select * into t from transactions where id=p_transaction_id for update;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id,t.outlet_id);
  if t.status not in ('held','split') then raise exception 'Bill tidak berstatus ditahan'; end if;
  return jsonb_build_object('transactionId',t.id,'number',t.number,'customerName',t.customer_name,'customerPhone',t.customer_phone,'tableNumber',t.table_number);
end $$;
grant execute on function public.recall_held_bill(uuid) to authenticated;
