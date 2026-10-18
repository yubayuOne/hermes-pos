-- Backoffice Transaksi page: the owner corrects completed bills (void, payment method, name/table/notes, items), and
-- owner_product_sales also returns sales per product for the Produk terjual tab.
--
-- Every edit locks the bill's shift first (same order as close_shift and owner_update_expense), then the bill. The
-- payments trigger rebuilds the bill's cash book row; a closed shift gets expected_cash and variance recomputed while
-- the counted cash stays. Bills with a refund cannot change money; split bills and voucher bills keep their items.

-- Loads and locks a completed bill of the signed-in owner. Internal.
create or replace function public._066_owner_bill(p_transaction_id uuid, p_what text)
returns public.transactions
language plpgsql security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); t public.transactions%rowtype;
begin
  select * into t from public.transactions where id = p_transaction_id;
  if not found or not public.is_owner_of_outlet(t.outlet_id) then raise exception 'Bill tidak ditemukan'; end if;
  if not public.subscription_active(b) then perform public.raise_expired(p_what); end if;
  perform 1 from public.shifts where id = t.shift_id for update;
  select * into t from public.transactions where id = t.id for update;
  if t.status <> 'completed' then
    raise exception 'Hanya bill yang sudah dibayar yang bisa diubah.' using errcode = 'P0001', hint = 'bill_not_completed';
  end if;
  return t;
end $$;
revoke all on function public._066_owner_bill(uuid, text) from public, anon, authenticated;

-- Expected cash of a closed shift from its cash book; an open shift computes it live. Internal.
create or replace function public._066_recount_shift(p_shift_id uuid)
returns void
language sql security definer set search_path = public as $$
  update public.shifts s set expected_cash = x.v, variance = s.closing_cash - x.v
  from (select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) as v
        from public.cash_ledger where shift_id = p_shift_id) x
  where s.id = p_shift_id and s.status = 'closed';
$$;
revoke all on function public._066_recount_shift(uuid) from public, anon, authenticated;

create or replace function public._066_no_refund(t public.transactions)
returns void
language plpgsql as $$
begin
  if t.refunded_total > 0 then
    raise exception 'Bill ini sudah direfund. Bill yang sudah direfund tidak bisa diubah.' using errcode = 'P0001', hint = 'already_refunded';
  end if;
end $$;
revoke all on function public._066_no_refund(public.transactions) from public, anon, authenticated;

-- Void from the backoffice: like void_transaction, but also for a closed shift.
create or replace function public.owner_void_bill(p_transaction_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.transactions%rowtype; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 3 then raise exception 'Alasan pembatalan wajib diisi'; end if;
  if char_length(v_reason) > 200 then raise exception 'Alasan maksimal 200 karakter'; end if;
  t := public._066_owner_bill(p_transaction_id, 'membatalkan bill');
  if t.parent_transaction_id is not null then raise exception 'Bill hasil Split Bill tidak dapat dibatalkan satu per satu'; end if;
  perform public._066_no_refund(t);

  update public.products p set stock = p.stock + x.qty
  from (select product_id, sum(quantity) as qty from public.transaction_items where transaction_id = t.id group by 1) x
  where p.id = x.product_id and p.track_stock;
  update public.payments set status = 'refunded' where transaction_id = t.id;
  update public.transactions set status = 'voided', voided_at = now(), void_reason = v_reason where id = t.id;
  perform public._066_recount_shift(t.shift_id);
  return jsonb_build_object('number', t.number, 'total', t.total);
end $$;

-- Cash <-> QRIS. The amount received becomes the total (no change).
create or replace function public.owner_set_bill_payment(p_transaction_id uuid, p_method public.payment_method)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.transactions%rowtype;
begin
  if p_method is null or p_method not in ('cash', 'qris') then raise exception 'Metode bayar tidak valid'; end if;
  t := public._066_owner_bill(p_transaction_id, 'mengubah transaksi');
  perform public._066_no_refund(t);
  if t.payment_method is distinct from p_method then
    update public.payments set method = p_method, amount_received = t.total, change_amount = 0
    where transaction_id = t.id and status = 'paid';
    update public.transactions set payment_method = p_method where id = t.id;
    perform public._066_recount_shift(t.shift_id);
  end if;
  return jsonb_build_object('number', t.number, 'total', t.total, 'paymentMethod', p_method);
end $$;

-- Customer name, table, and item notes ({"<item id>": "note"}; items left out keep theirs). Same limits as the POS.
create or replace function public.owner_update_bill_details(p_transaction_id uuid, p_customer_name text, p_table_number text, p_notes jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.transactions%rowtype;
  v_name text := btrim(coalesce(p_customer_name, ''));
  v_table text := btrim(coalesce(p_table_number, ''));
  v_notes jsonb := coalesce(p_notes, '{}'::jsonb);
begin
  if char_length(v_name) > 40 then raise exception 'Nama pelanggan maksimal 40 karakter'; end if;
  if char_length(v_table) > 6 then raise exception 'Nomor meja maksimal 6 karakter'; end if;
  if jsonb_typeof(v_notes) <> 'object' then raise exception 'Data item tidak valid'; end if;
  if exists (select 1 from jsonb_each(v_notes) n where jsonb_typeof(n.value) <> 'string' or char_length(btrim(n.value #>> '{}')) > 200) then
    raise exception 'Catatan item maksimal 200 karakter';
  end if;
  t := public._066_owner_bill(p_transaction_id, 'mengubah transaksi');
  if exists (select 1 from jsonb_object_keys(v_notes) k
             where not exists (select 1 from public.transaction_items ti where ti.transaction_id = t.id and ti.id::text = k)) then
    raise exception 'Item tidak ada di bill ini';
  end if;

  update public.transactions set customer_name = v_name, table_number = v_table where id = t.id;
  update public.transaction_items ti set note = nullif(btrim(n.value), '')
  from jsonb_each_text(v_notes) n
  where ti.transaction_id = t.id and ti.id::text = n.key;
  return jsonb_build_object('number', t.number);
end $$;

-- Items and quantities. p_items is the whole new list: [{"itemId", "quantity"}] for lines already on the bill (quantity 0
-- or left out = removed) and [{"productId", "quantity"}] for new lines at today's catalog price. Line discounts keep
-- their type (percent recomputed, amount capped at the line), the bill discount is applied again, stock follows.
create or replace function public.owner_update_bill_items(p_transaction_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.transactions%rowtype;
  v_gross numeric;
  v_idisc numeric;
  v_hpp numeric;
  v_total numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Isi minimal satu item'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Maksimal 200 item'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where jsonb_typeof(e) <> 'object' or (e ? 'itemId') = (e ? 'productId')
               or coalesce(e->>'itemId', e->>'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               or coalesce(e->>'quantity', '') !~ '^[0-9]{1,4}$') then
    raise exception 'Data item tidak valid';
  end if;
  t := public._066_owner_bill(p_transaction_id, 'mengubah transaksi');
  if t.parent_transaction_id is not null then raise exception 'Item bill hasil Split Bill tidak bisa diubah'; end if;
  perform public._066_no_refund(t);
  if exists (select 1 from public.voucher_redemptions where transaction_id = t.id) then
    raise exception 'Item bill yang memakai voucher tidak bisa diubah' using errcode = 'P0001', hint = 'voucher_bill';
  end if;

  create temporary table if not exists pg_temp.tmp_066_lines (item_id uuid, product_id uuid, quantity numeric) on commit drop;
  truncate pg_temp.tmp_066_lines;
  insert into pg_temp.tmp_066_lines
  select (e->>'itemId')::uuid, (e->>'productId')::uuid, (e->>'quantity')::numeric from jsonb_array_elements(p_items) e;
  if (select count(item_id) <> count(distinct item_id) from pg_temp.tmp_066_lines) then raise exception 'Data item tidak valid'; end if;
  if exists (select 1 from pg_temp.tmp_066_lines l where l.item_id is not null
             and not exists (select 1 from public.transaction_items ti where ti.id = l.item_id and ti.transaction_id = t.id)) then
    raise exception 'Item tidak ada di bill ini';
  end if;
  if exists (select 1 from pg_temp.tmp_066_lines l where l.product_id is not null and l.quantity > 0
             and not exists (select 1 from public.products p where p.id = l.product_id and p.outlet_id = t.outlet_id and p.is_active)) then
    raise exception 'Produk tidak ditemukan atau sudah tidak aktif';
  end if;

  -- Put the old quantities back, change the lines, then take the new quantities out again.
  update public.products p set stock = p.stock + x.qty
  from (select product_id, sum(quantity) as qty from public.transaction_items where transaction_id = t.id group by 1) x
  where p.id = x.product_id and p.track_stock;

  delete from public.transaction_items ti
  where ti.transaction_id = t.id
    and not exists (select 1 from pg_temp.tmp_066_lines l where l.item_id = ti.id and l.quantity > 0);
  update public.transaction_items ti
  set quantity = l.quantity,
      discount_amount = case ti.discount_type
        when 'percent' then public.calc_discount(l.quantity * ti.selling_price_unit, 'percent', ti.discount_value)
        when 'amount' then least(ti.discount_value, l.quantity * ti.selling_price_unit)
        else 0 end,
      discount_value = case when ti.discount_type = 'amount' then least(ti.discount_value, l.quantity * ti.selling_price_unit) else ti.discount_value end
  from pg_temp.tmp_066_lines l
  where l.item_id = ti.id and ti.transaction_id = t.id;
  insert into public.transaction_items(transaction_id, product_id, quantity, hpp_unit, selling_price_unit)
  select t.id, p.id, x.qty, p.hpp, p.selling_price
  from (select product_id, sum(quantity) as qty from pg_temp.tmp_066_lines where product_id is not null group by 1) x
  join public.products p on p.id = x.product_id
  where x.qty > 0
  order by p.id;

  if exists (select 1 from public.products p
             join (select product_id, sum(quantity) as qty from public.transaction_items where transaction_id = t.id group by 1) x on x.product_id = p.id
             where p.track_stock and p.stock < x.qty) then
    raise exception 'Stok produk tidak mencukupi';
  end if;
  update public.products p set stock = p.stock - x.qty
  from (select product_id, sum(quantity) as qty from public.transaction_items where transaction_id = t.id group by 1) x
  where p.id = x.product_id and p.track_stock;

  select coalesce(sum(quantity * selling_price_unit), 0), coalesce(sum(discount_amount), 0), coalesce(sum(quantity * hpp_unit), 0)
    into v_gross, v_idisc, v_hpp
  from public.transaction_items where transaction_id = t.id;
  v_total := public.set_bill_totals(t.id, v_gross, v_idisc, t.bill_discount_type, t.bill_discount_value);
  update public.transactions set total_hpp = v_hpp where id = t.id;

  -- Cash keeps what the customer handed over when it still covers the bill; the cash book gets the new total either way.
  update public.payments
  set amount_received = case when method = 'cash' then greatest(amount_received, v_total) else v_total end,
      change_amount = case when method = 'cash' then greatest(amount_received, v_total) - v_total else 0 end
  where transaction_id = t.id and status = 'paid';
  perform public._066_recount_shift(t.shift_id);
  return jsonb_build_object('number', t.number, 'total', v_total, 'previousTotal', t.total);
end $$;

revoke all on function public.owner_void_bill(uuid, text) from public, anon;
revoke all on function public.owner_set_bill_payment(uuid, public.payment_method) from public, anon;
revoke all on function public.owner_update_bill_details(uuid, text, text, jsonb) from public, anon;
revoke all on function public.owner_update_bill_items(uuid, jsonb) from public, anon;
grant execute on function public.owner_void_bill(uuid, text) to authenticated;
grant execute on function public.owner_set_bill_payment(uuid, public.payment_method) to authenticated;
grant execute on function public.owner_update_bill_details(uuid, text, text, jsonb) to authenticated;
grant execute on function public.owner_update_bill_items(uuid, jsonb) to authenticated;

-- Same scan as 061, now { "<product id>": { "qty", "sales" } }; sales = line totals after item discounts, as in
-- owner_report's product table. Completed bills only; refunds are not subtracted.
create or replace function public.owner_product_sales(p_outlet_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  perform public.require_owner_business();
  if not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_to <= p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'Rentang tanggal terlalu panjang'; end if;

  select coalesce(jsonb_object_agg(x.product_id, jsonb_build_object('qty', x.qty, 'sales', x.sales)), '{}'::jsonb) into result
  from (
    select ti.product_id, sum(ti.quantity) as qty, sum(ti.net_subtotal) as sales
    from public.transactions t
    join public.transaction_items ti on ti.transaction_id = t.id
    where t.outlet_id = p_outlet_id and t.status = 'completed' and t.created_at >= p_from and t.created_at < p_to
      and ti.product_id is not null
    group by 1
  ) x;
  return result;
end $$;
