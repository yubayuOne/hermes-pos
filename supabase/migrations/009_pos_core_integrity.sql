-- KASBOX POS core integrity hardening
-- Goal: make the POS transactional core authoritative in PostgreSQL and resilient
-- to retries, race conditions, and unsafe shift closure.

-- 1) Never allow a shift to be closed while it still owns an active held bill.
--    A held bill must be paid or explicitly handled before the cash drawer is closed.
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
  v_cash_sales numeric := 0;
  v_expected_cash numeric := 0;
  v_variance_amount numeric := 0;
  v_held_count integer := 0;
begin
  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if not found then
    raise exception 'Shift tidak ditemukan';
  end if;

  perform public.assert_cashier(v_shift.cashier_id, v_shift.outlet_id);

  if p_physical_cash < 0 then
    raise exception 'Kas fisik tidak valid';
  end if;

  if v_shift.status <> 'open' then
    raise exception 'Shift sudah ditutup';
  end if;

  select count(*)::integer
    into v_held_count
  from public.transactions t
  where t.shift_id = v_shift.id
    and t.status = 'held';

  if v_held_count > 0 then
    raise exception 'Masih ada % Bill Ditahan. Selesaikan atau batalkan Bill Ditahan sebelum menutup shift.', v_held_count;
  end if;

  select coalesce(sum(p.amount_received - p.change_amount), 0)
    into v_cash_sales
  from public.payments p
  join public.transactions t on t.id = p.transaction_id
  where t.shift_id = v_shift.id
    and t.status = 'completed'
    and p.method = 'cash'
    and p.status = 'paid';

  v_expected_cash := v_shift.opening_cash + v_cash_sales;
  v_variance_amount := p_physical_cash - v_expected_cash;

  update public.shifts sh
  set closed_at = now(),
      closing_cash = p_physical_cash,
      expected_cash = v_expected_cash,
      variance = v_variance_amount,
      status = 'closed'
  where sh.id = v_shift.id;

  return jsonb_build_object(
    'expected_cash', v_expected_cash,
    'variance', v_variance_amount
  );
end;
$$;

grant execute on function public.close_shift(uuid, numeric) to authenticated;

-- 2) Serialize checkout against close_shift.
--    Without this lock, a checkout could observe an open shift while close_shift
--    simultaneously closes it, allowing a payment to land in a closed shift.
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
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);

  select s.status
    into v_status
  from public.shifts s
  where s.id = p_shift_id
    and s.cashier_id = p_cashier_id
    and s.outlet_id = p_outlet_id
  for update;

  if not found or v_status <> 'open' then
    raise exception 'Shift aktif tidak ditemukan';
  end if;
end;
$$;

grant execute on function public.assert_open_shift(uuid, uuid, uuid) to authenticated;

-- 3) Harden save_held_bill against the same close-vs-write race.
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

  for it in select value as it from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) order by value->>'product_id' loop
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

  perform public.assert_open_shift(p_shift_id, p_cashier_id, p_outlet_id);

  if p_existing_transaction_id is not null then
    select * into target_tx from transactions where id=p_existing_transaction_id for update;
    if not found then raise exception 'Bill tidak ditemukan'; end if;
    if target_tx.shift_id<>p_shift_id or target_tx.cashier_id<>p_cashier_id or target_tx.outlet_id<>p_outlet_id then raise exception 'Bill tidak sesuai dengan sesi kasir'; end if;
    if target_tx.status not in ('held','draft') then raise exception 'Bill tidak dapat dibayar'; end if;

    tid := target_tx.id;
    tnumber := target_tx.number;

    for it in select value as it from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) order by value->>'product_id' loop
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

  for it in select value as it from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) order by value->>'product_id' loop
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

-- 4) Serialize Open Shift before checking the active-shift invariant.
--    The partial unique index remains the final database backstop, while this
--    lock makes concurrent requests deterministic and user-friendly.
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
  ) values(
    p_cashier_id,p_outlet_id,v_business_date,v_shift_number,p_opening_cash
  ) returning id into sid;

  return sid;
end;
$$;

grant execute on function public.open_shift(uuid,uuid,numeric) to authenticated;
