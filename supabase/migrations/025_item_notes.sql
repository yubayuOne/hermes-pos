-- 025: catatan per item (mis. "tanpa es", "pedas").
-- Catatan melekat pada baris produk di transaction_items, disimpan oleh save_held_bill / complete_checkout
-- (maks 200 karakter, spasi ujung dibuang, kosong = tidak ada catatan) dan dikembalikan oleh
-- get_held_bill_items (juga dipakai recall_held_bill_with_items) dan get_bill_items.
-- Catatan tidak memengaruhi harga, stok, atau diskon.

alter table public.transaction_items
  add column if not exists note text;
alter table public.transaction_items
  drop constraint if exists transaction_items_note_len;
alter table public.transaction_items
  add constraint transaction_items_note_len check (note is null or char_length(note) <= 200);

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
grant execute on function public.save_held_bill(uuid,uuid,uuid,jsonb,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) complete_checkout (gabungan 016 + diskon). Overload lama 9 argumen dihapus:
--    klien selalu memakai versi 10 argumen, dan versi lama tidak mengenal diskon.
-- ---------------------------------------------------------------------------
drop function if exists public.complete_checkout(uuid,uuid,uuid,jsonb,public.payment_method,numeric,text,text,uuid);

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
  dtype text;
  dval numeric;
  phpp numeric;
  pprice numeric;
  stock numeric;
  parent_qty numeric;
  allocated_qty numeric;
  parent_disc numeric;
  allocated_disc numeric;
  rem_qty numeric;
  rem_disc numeric;
  v_gross numeric := 0;
  v_idisc numeric := 0;
  v_total numeric := 0;
  v_thpp numeric := 0;
  v_change numeric := 0;
  v_gl numeric;
  v_d numeric;
  v_d1 numeric;
  v_d2 numeric;
  g1 numeric;
  g2 numeric;
  b_type text;
  b_val numeric;
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
  -- Bill yang sudah ada (ditahan/draft). Database memegang snapshot itemnya;
  -- keranjang kasir saat ini (termasuk diskon) menjadi keadaan akhir bill.
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
      quantity numeric not null,
      discount_type text,
      discount_value numeric
    ) on commit drop;
    truncate pg_temp.tmp_desired_lines;

    insert into pg_temp.tmp_desired_lines(product_id,quantity,discount_type,discount_value)
    select (value->>'product_id')::uuid,
           sum((value->>'quantity')::numeric),
           (array_agg(value->>'discount_type'))[1],
           max(coalesce((value->>'discount_value')::numeric,0))
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb))
    group by (value->>'product_id')::uuid;

    if not exists(select 1 from pg_temp.tmp_desired_lines where quantity>0) then
      raise exception 'Bill kosong';
    end if;

    delete from transaction_items where transaction_id=tid;

    for pid,qty,dtype,dval in
      select d.product_id,d.quantity,d.discount_type,d.discount_value
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

      -- g1: bagian yang sudah ditahan (harga/HPP historis), g2: tambahan baru (harga katalog saat ini).
      if qty<=stored_qty then
        g1:=qty*stored_price; g2:=0;
      else
        g1:=stored_qty*stored_price; g2:=(qty-stored_qty)*pprice;
      end if;
      v_gl:=g1+g2;
      v_d:=public.calc_discount(v_gl,dtype,dval);
      if g2=0 then v_d1:=v_d; v_d2:=0;
      elsif g1=0 then v_d1:=0; v_d2:=v_d;
      else v_d1:=round(v_d*g1/v_gl); v_d2:=v_d-v_d1;
      end if;

      if qty<=stored_qty then
        insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit,discount_amount,discount_type,discount_value)
        values(tid,pid,qty,stored_hpp,stored_price,v_d1,
               case when v_d>0 then dtype else null end,
               case when v_d>0 then dval else null end);
        v_thpp:=v_thpp+qty*stored_hpp;
      else
        if stored_qty>0 then
          insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit,discount_amount,discount_type,discount_value)
          values(tid,pid,stored_qty,stored_hpp,stored_price,v_d1,
                 case when v_d>0 and g2=0 then dtype when v_d1>0 then 'amount' else null end,
                 case when v_d>0 and g2=0 then dval when v_d1>0 then v_d1 else null end);
          v_thpp:=v_thpp+stored_qty*stored_hpp;
        end if;
        insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit,discount_amount,discount_type,discount_value)
        values(tid,pid,qty-stored_qty,phpp,pprice,v_d2,
               case when v_d>0 and g1=0 then dtype when v_d2>0 then 'amount' else null end,
               case when v_d>0 and g1=0 then dval when v_d2>0 then v_d2 else null end);
        v_thpp:=v_thpp+(qty-stored_qty)*phpp;
      end if;

      v_gross:=v_gross+v_gl;
      v_idisc:=v_idisc+v_d;
      update products p set stock=p.stock-qty where p.id=pid;
    end loop;

    update transactions
    set customer_name=coalesce(p_payload->>'customer_name',target_tx.customer_name),
        customer_phone=coalesce(p_payload->>'customer_phone',target_tx.customer_phone),
        table_number=coalesce(p_payload->>'table_number',target_tx.table_number)
    where id=tid;

    v_total:=public.set_bill_totals(tid,v_gross,v_idisc,p_payload->>'bill_discount_type',(p_payload->>'bill_discount_value')::numeric);

    if p_payment_method='cash' then
      if p_amount_received<v_total then raise exception 'Uang diterima kurang'; end if;
      v_change:=p_amount_received-v_total;
    else
      p_amount_received:=v_total;
      v_change:=0;
    end if;

    update transactions
    set total_hpp=v_thpp,
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
  -- Bill baru, atau anak Split Bill.
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

    -- Diskon bill induk dipindah ke baris item sebelum dibagi ke bayaran split.
    perform public.bake_bill_discount(p_parent_transaction_id);
    b_type:=null; b_val:=null;
  else
    b_type:=p_payload->>'bill_discount_type';
    b_val:=(p_payload->>'bill_discount_value')::numeric;
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
      'quantity',sum((value->>'quantity')::numeric),
      'discount_type',(array_agg(value->>'discount_type'))[1],
      'discount_value',max(coalesce((value->>'discount_value')::numeric,0))
    ) as it
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb))
    group by value->>'product_id'
    order by value->>'product_id'
  loop
    pid:=(it->>'product_id')::uuid;
    qty:=(it->>'quantity')::numeric;
    dtype:=it->>'discount_type';
    dval:=(it->>'discount_value')::numeric;
    if qty<=0 then raise exception 'Kuantitas tidak valid'; end if;

    if p_parent_transaction_id is not null then
      select coalesce(sum(ti.quantity),0),coalesce(sum(ti.discount_amount),0)
        into parent_qty,parent_disc
      from transaction_items ti
      where ti.transaction_id=p_parent_transaction_id and ti.product_id=pid;

      if parent_qty<=0 then raise exception 'Produk tidak tersedia pada Split Bill'; end if;

      select coalesce(sum(child_item.quantity),0),coalesce(sum(child_item.discount_amount),0)
        into allocated_qty,allocated_disc
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

      -- Bagian diskon: sisa diskon baris x qty / sisa qty; bagian terakhir mengambil seluruh sisa.
      rem_qty:=parent_qty-allocated_qty;
      rem_disc:=parent_disc-allocated_disc;
      if qty=rem_qty then v_d:=rem_disc;
      else v_d:=round(rem_disc*qty/rem_qty);
      end if;
      v_d:=least(v_d,qty*pprice);
      dtype:=case when v_d>0 then 'amount' else null end;
      dval:=case when v_d>0 then v_d else null end;
    else
      select p.hpp,p.selling_price into phpp,pprice
      from products p
      where p.id=pid and p.outlet_id=p_outlet_id and p.is_active;
      if not found then raise exception 'Produk tidak ditemukan'; end if;
      v_d:=public.calc_discount(qty*pprice,dtype,dval);
    end if;

    select p.stock into stock
    from products p
    where p.id=pid and p.outlet_id=p_outlet_id and p.is_active
    for update;

    if not found then raise exception 'Produk tidak ditemukan'; end if;
    if stock<qty then raise exception 'Stok produk tidak mencukupi'; end if;

    insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit,discount_amount,discount_type,discount_value)
    values(tid,pid,qty,phpp,pprice,v_d,
           case when v_d>0 then dtype else null end,
           case when v_d>0 then dval else null end);

    v_gross:=v_gross+qty*pprice;
    v_idisc:=v_idisc+v_d;
    v_thpp:=v_thpp+qty*phpp;
    update products p set stock=p.stock-qty where p.id=pid;
  end loop;

  v_total:=public.set_bill_totals(tid,v_gross,v_idisc,b_type,b_val);

  if p_payment_method='cash' then
    if p_amount_received<v_total then raise exception 'Uang diterima kurang'; end if;
    v_change:=p_amount_received-v_total;
  else
    p_amount_received:=v_total;
    v_change:=0;
  end if;

  update transactions
  set total_hpp=v_thpp,
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

-- ---------------------------------------------------------------------------
-- 5) Mulai Split Bill: diskon bill dipindah ke baris item lebih dulu.
-- ---------------------------------------------------------------------------
create or replace function public.start_split_from_held(p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t transactions%rowtype;
begin
  select * into t from transactions where id=p_transaction_id for update;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id,t.outlet_id);
  if t.status not in ('held','split') then raise exception 'Bill tidak dapat digunakan untuk Split Bill'; end if;
  perform public.bake_bill_discount(t.id);
  return jsonb_build_object('transactionId',t.id,'number',t.number,'customerName',t.customer_name,'customerPhone',t.customer_phone,'tableNumber',t.table_number);
end $$;

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
  dtype text;
  dval numeric;
  dnote text;
  phpp numeric;
  pprice numeric;
  stock numeric;
  parent_qty numeric;
  allocated_qty numeric;
  parent_disc numeric;
  allocated_disc numeric;
  rem_qty numeric;
  rem_disc numeric;
  v_gross numeric := 0;
  v_idisc numeric := 0;
  v_total numeric := 0;
  v_thpp numeric := 0;
  v_change numeric := 0;
  v_gl numeric;
  v_d numeric;
  v_d1 numeric;
  v_d2 numeric;
  g1 numeric;
  g2 numeric;
  b_type text;
  b_val numeric;
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
  -- Bill yang sudah ada (ditahan/draft). Database memegang snapshot itemnya;
  -- keranjang kasir saat ini (termasuk diskon) menjadi keadaan akhir bill.
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
      quantity numeric not null,
      discount_type text,
      discount_value numeric,
      note text
    ) on commit drop;
    truncate pg_temp.tmp_desired_lines;

    insert into pg_temp.tmp_desired_lines(product_id,quantity,discount_type,discount_value,note)
    select (value->>'product_id')::uuid,
           sum((value->>'quantity')::numeric),
           (array_agg(value->>'discount_type'))[1],
           max(coalesce((value->>'discount_value')::numeric,0)),
           left(max(nullif(btrim(value->>'note'),'')),200)
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb))
    group by (value->>'product_id')::uuid;

    if not exists(select 1 from pg_temp.tmp_desired_lines where quantity>0) then
      raise exception 'Bill kosong';
    end if;

    delete from transaction_items where transaction_id=tid;

    for pid,qty,dtype,dval,dnote in
      select d.product_id,d.quantity,d.discount_type,d.discount_value,d.note
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

      -- g1: bagian yang sudah ditahan (harga/HPP historis), g2: tambahan baru (harga katalog saat ini).
      if qty<=stored_qty then
        g1:=qty*stored_price; g2:=0;
      else
        g1:=stored_qty*stored_price; g2:=(qty-stored_qty)*pprice;
      end if;
      v_gl:=g1+g2;
      v_d:=public.calc_discount(v_gl,dtype,dval);
      if g2=0 then v_d1:=v_d; v_d2:=0;
      elsif g1=0 then v_d1:=0; v_d2:=v_d;
      else v_d1:=round(v_d*g1/v_gl); v_d2:=v_d-v_d1;
      end if;

      if qty<=stored_qty then
        insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit,discount_amount,discount_type,discount_value,note)
        values(tid,pid,qty,stored_hpp,stored_price,v_d1,
               case when v_d>0 then dtype else null end,
               case when v_d>0 then dval else null end,dnote);
        v_thpp:=v_thpp+qty*stored_hpp;
      else
        if stored_qty>0 then
          insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit,discount_amount,discount_type,discount_value,note)
          values(tid,pid,stored_qty,stored_hpp,stored_price,v_d1,
                 case when v_d>0 and g2=0 then dtype when v_d1>0 then 'amount' else null end,
                 case when v_d>0 and g2=0 then dval when v_d1>0 then v_d1 else null end,dnote);
          v_thpp:=v_thpp+stored_qty*stored_hpp;
        end if;
        insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit,discount_amount,discount_type,discount_value,note)
        values(tid,pid,qty-stored_qty,phpp,pprice,v_d2,
               case when v_d>0 and g1=0 then dtype when v_d2>0 then 'amount' else null end,
               case when v_d>0 and g1=0 then dval when v_d2>0 then v_d2 else null end,dnote);
        v_thpp:=v_thpp+(qty-stored_qty)*phpp;
      end if;

      v_gross:=v_gross+v_gl;
      v_idisc:=v_idisc+v_d;
      update products p set stock=p.stock-qty where p.id=pid;
    end loop;

    update transactions
    set customer_name=coalesce(p_payload->>'customer_name',target_tx.customer_name),
        customer_phone=coalesce(p_payload->>'customer_phone',target_tx.customer_phone),
        table_number=coalesce(p_payload->>'table_number',target_tx.table_number)
    where id=tid;

    v_total:=public.set_bill_totals(tid,v_gross,v_idisc,p_payload->>'bill_discount_type',(p_payload->>'bill_discount_value')::numeric);

    if p_payment_method='cash' then
      if p_amount_received<v_total then raise exception 'Uang diterima kurang'; end if;
      v_change:=p_amount_received-v_total;
    else
      p_amount_received:=v_total;
      v_change:=0;
    end if;

    update transactions
    set total_hpp=v_thpp,
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
  -- Bill baru, atau anak Split Bill.
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

    -- Diskon bill induk dipindah ke baris item sebelum dibagi ke bayaran split.
    perform public.bake_bill_discount(p_parent_transaction_id);
    b_type:=null; b_val:=null;
  else
    b_type:=p_payload->>'bill_discount_type';
    b_val:=(p_payload->>'bill_discount_value')::numeric;
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
      'quantity',sum((value->>'quantity')::numeric),
      'discount_type',(array_agg(value->>'discount_type'))[1],
      'discount_value',max(coalesce((value->>'discount_value')::numeric,0)),
      'note',max(nullif(btrim(value->>'note'),''))
    ) as it
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb))
    group by value->>'product_id'
    order by value->>'product_id'
  loop
    pid:=(it->>'product_id')::uuid;
    qty:=(it->>'quantity')::numeric;
    dtype:=it->>'discount_type';
    dval:=(it->>'discount_value')::numeric;
    dnote:=left(it->>'note',200);
    if qty<=0 then raise exception 'Kuantitas tidak valid'; end if;

    if p_parent_transaction_id is not null then
      select coalesce(sum(ti.quantity),0),coalesce(sum(ti.discount_amount),0)
        into parent_qty,parent_disc
      from transaction_items ti
      where ti.transaction_id=p_parent_transaction_id and ti.product_id=pid;

      if parent_qty<=0 then raise exception 'Produk tidak tersedia pada Split Bill'; end if;

      select coalesce(sum(child_item.quantity),0),coalesce(sum(child_item.discount_amount),0)
        into allocated_qty,allocated_disc
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

      -- Bagian diskon: sisa diskon baris x qty / sisa qty; bagian terakhir mengambil seluruh sisa.
      rem_qty:=parent_qty-allocated_qty;
      rem_disc:=parent_disc-allocated_disc;
      if qty=rem_qty then v_d:=rem_disc;
      else v_d:=round(rem_disc*qty/rem_qty);
      end if;
      v_d:=least(v_d,qty*pprice);
      dtype:=case when v_d>0 then 'amount' else null end;
      dval:=case when v_d>0 then v_d else null end;
    else
      select p.hpp,p.selling_price into phpp,pprice
      from products p
      where p.id=pid and p.outlet_id=p_outlet_id and p.is_active;
      if not found then raise exception 'Produk tidak ditemukan'; end if;
      v_d:=public.calc_discount(qty*pprice,dtype,dval);
    end if;

    select p.stock into stock
    from products p
    where p.id=pid and p.outlet_id=p_outlet_id and p.is_active
    for update;

    if not found then raise exception 'Produk tidak ditemukan'; end if;
    if stock<qty then raise exception 'Stok produk tidak mencukupi'; end if;

    insert into transaction_items(transaction_id,product_id,quantity,hpp_unit,selling_price_unit,discount_amount,discount_type,discount_value,note)
    values(tid,pid,qty,phpp,pprice,v_d,
           case when v_d>0 then dtype else null end,
           case when v_d>0 then dval else null end,dnote);

    v_gross:=v_gross+qty*pprice;
    v_idisc:=v_idisc+v_d;
    v_thpp:=v_thpp+qty*phpp;
    update products p set stock=p.stock-qty where p.id=pid;
  end loop;

  v_total:=public.set_bill_totals(tid,v_gross,v_idisc,b_type,b_val);

  if p_payment_method='cash' then
    if p_amount_received<v_total then raise exception 'Uang diterima kurang'; end if;
    v_change:=p_amount_received-v_total;
  else
    p_amount_received:=v_total;
    v_change:=0;
  end if;

  update transactions
  set total_hpp=v_thpp,
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

-- ---------------------------------------------------------------------------
-- 5) Mulai Split Bill: diskon bill dipindah ke baris item lebih dulu.
-- ---------------------------------------------------------------------------
create or replace function public.start_split_from_held(p_transaction_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t transactions%rowtype;
begin
  select * into t from transactions where id=p_transaction_id for update;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id,t.outlet_id);
  if t.status not in ('held','split') then raise exception 'Bill tidak dapat digunakan untuk Split Bill'; end if;
  perform public.bake_bill_discount(t.id);
  return jsonb_build_object('transactionId',t.id,'number',t.number,'customerName',t.customer_name,'customerPhone',t.customer_phone,'tableNumber',t.table_number);
end $$;

create or replace function public.get_held_bill_items(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.transactions%rowtype;
begin
  select * into t from public.transactions where id=p_transaction_id;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id,t.outlet_id);

  return coalesce((
    with parent as (
      select ti.product_id,
             sum(ti.quantity)           as qty,
             max(ti.hpp_unit)           as hpp_unit,
             max(ti.selling_price_unit) as price_unit,
             sum(ti.discount_amount)    as disc,
             count(*)                   as nrows,
             max(ti.discount_type)      as dtype,
             max(ti.discount_value)     as dvalue,
             max(ti.note)               as note
      from public.transaction_items ti
      where ti.transaction_id=p_transaction_id
      group by ti.product_id
    ),
    allocated as (
      select ci.product_id, sum(ci.quantity) as qty, sum(ci.discount_amount) as disc
      from public.transactions c
      join public.transaction_items ci on ci.transaction_id=c.id
      where c.parent_transaction_id=p_transaction_id
        and c.status='completed'
      group by ci.product_id
    ),
    remaining as (
      select p.product_id,
             p.hpp_unit,
             p.price_unit,
             p.note,
             p.qty - coalesce(a.qty,0)   as qty,
             p.disc - coalesce(a.disc,0) as disc,
             case when coalesce(a.qty,0)=0 and p.nrows=1 and p.disc>0 then p.dtype end  as dtype,
             case when coalesce(a.qty,0)=0 and p.nrows=1 and p.disc>0 then p.dvalue end as dvalue
      from parent p
      left join allocated a on a.product_id=p.product_id
    )
    select jsonb_agg(
             jsonb_build_object(
               'productId', r.product_id,
               'name',      pr.name,
               'unitPrice', r.price_unit,
               'hpp',       r.hpp_unit,
               'quantity',  r.qty,
               'stock',     greatest(pr.stock, r.qty),
               'station',   pr.station,
               'discountAmount', r.disc,
               'discountType',   case when r.disc>0 then coalesce(r.dtype,'amount') end,
               'discountValue',  case when r.disc>0 then coalesce(r.dvalue,r.disc) end,
               'note',           r.note
             )
             order by pr.name, r.product_id
           )
    from remaining r
    join public.products pr on pr.id=r.product_id
    where r.qty > 0
  ), '[]'::jsonb);
end $$;

create or replace function public.get_bill_items(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.transactions%rowtype;
begin
  select * into t from public.transactions where id=p_transaction_id;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id,t.outlet_id);

  if t.status::text='held' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId',x->>'productId','productName',x->>'name','station',x->>'station',
        'quantity',(x->>'quantity')::numeric,'unitPrice',(x->>'unitPrice')::numeric,
        'subtotal',(x->>'quantity')::numeric*(x->>'unitPrice')::numeric,
        'discount',coalesce((x->>'discountAmount')::numeric,0),
        'note',x->>'note'))
      from jsonb_array_elements(public.get_held_bill_items(p_transaction_id)) x
    ),'[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'productId',ti.product_id,'productName',pr.name,'station',pr.station,
      'quantity',ti.quantity,'unitPrice',ti.selling_price_unit,'subtotal',ti.subtotal,
      'discount',ti.discount_amount,'note',ti.note) order by pr.name, ti.id)
    from public.transaction_items ti join public.products pr on pr.id=ti.product_id
    where ti.transaction_id=p_transaction_id
  ),'[]'::jsonb);
end $$;

grant execute on function public.get_held_bill_items(uuid) to authenticated;
grant execute on function public.get_bill_items(uuid)      to authenticated;
