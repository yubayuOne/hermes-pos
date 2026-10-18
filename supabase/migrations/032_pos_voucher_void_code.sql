-- 032: what the POS app needs on top of 030 and 031.
--   1. Vouchers at the till (PRD C5): pos_check_voucher for the preview, and complete_checkout applies a
--      voucher_code from the payload on the server, counts it against the quota once, and records it.
--   2. Owner approval code for voids (PRD C8, DESIGN I5.11): a 6-digit code the owner sets in the backoffice.
--      void_transaction is no longer callable directly; the POS calls void_transaction_approved.
--   3. list_device_cashiers also returns pin_locked_until, so the cashier list can show "terkunci 4 menit".
--   4. update_held_bill: a recalled held bill that the cashier changed is saved back as the same bill
--      (DESIGN I5.5: Tahan becomes Simpan), instead of creating a second held bill.
--
-- Decisions taken here because PRD section 20 leaves them open (listed in the POS README):
--   - One voucher per bill. A bill-wide voucher cannot be combined with a manual bill discount, and a
--     product voucher cannot be combined with a manual item discount on the same line.
--   - Minimum spend is compared with the bill subtotal before any discount.
--   - A product voucher takes its percent, or its amount per line (capped at the line price), off each
--     matching line.
--   - Vouchers are not used for split-bill parts. Voiding a bill does not give the voucher quota back.
--   - The approval code is one fixed code per business. Five wrong codes lock voids for 5 minutes.

-- ---------------------------------------------------------------- 1. vouchers at checkout
create table if not exists public.voucher_redemptions (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.vouchers(id) on delete cascade,
  transaction_id uuid not null unique references public.transactions(id) on delete cascade,
  cashier_id uuid not null,
  idempotency_key text not null,
  payload jsonb not null,
  amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (cashier_id, idempotency_key)
);
alter table public.voucher_redemptions enable row level security;
revoke all on public.voucher_redemptions from anon, authenticated;
drop policy if exists voucher_redemptions_owner_read on public.voucher_redemptions;
create policy voucher_redemptions_owner_read on public.voucher_redemptions for select to authenticated
  using (exists (select 1 from public.vouchers v where v.id = voucher_id and v.business_id = public.my_business_id()));
grant select on public.voucher_redemptions to authenticated;

-- Finds a usable voucher for the business of an outlet, or raises a sentence the cashier understands.
create or replace function public._032_find_voucher(p_outlet_id uuid, p_code text, p_lock boolean)
returns public.vouchers language plpgsql security definer set search_path = public as $$
declare
  v public.vouchers;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_today date;
begin
  if v_code = '' then raise exception 'Isi kode voucher.' using errcode = '22023'; end if;
  if p_lock then
    select vo.* into v from public.vouchers vo join public.outlets o on o.business_id = vo.business_id
    where o.id = p_outlet_id and vo.code = v_code for update of vo;
  else
    select vo.* into v from public.vouchers vo join public.outlets o on o.business_id = vo.business_id
    where o.id = p_outlet_id and vo.code = v_code;
  end if;
  if not found then raise exception 'Kode voucher tidak ditemukan.' using errcode = 'P0002', hint = 'voucher_not_found'; end if;
  select (now() at time zone coalesce(b.timezone, 'Asia/Jakarta'))::date into v_today from public.businesses b where b.id = v.business_id;
  if not v.is_active then raise exception 'Voucher ini sudah dinonaktifkan pemilik.' using errcode = 'P0001', hint = 'voucher_inactive'; end if;
  if v.expires_on < v_today then raise exception 'Voucher ini sudah berakhir.' using errcode = 'P0001', hint = 'voucher_expired'; end if;
  if v.quota is not null and v.used_count >= v.quota then raise exception 'Kuota voucher ini sudah habis.' using errcode = 'P0001', hint = 'voucher_used_up'; end if;
  return v;
end $$;
revoke all on function public._032_find_voucher(uuid, text, boolean) from public, anon, authenticated;

-- Preview for the till. The server applies the voucher again at checkout, so this only drives the screen.
create or replace function public.pos_check_voucher(p_cashier_id uuid, p_outlet_id uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.vouchers;
begin
  perform public.assert_cashier(p_cashier_id, p_outlet_id);
  v := public._032_find_voucher(p_outlet_id, p_code, false);
  return jsonb_build_object(
    'code', v.code, 'scope', v.scope, 'discount_type', v.discount_type, 'value', v.value,
    'min_spend', v.min_spend, 'expires_on', v.expires_on,
    'product_ids', coalesce((select jsonb_agg(vp.product_id) from public.voucher_products vp where vp.voucher_id = v.id), '[]'::jsonb));
end $$;
grant execute on function public.pos_check_voucher(uuid, uuid, text) to authenticated;

-- The checkout from 029 keeps its body; it becomes the core and a thin wrapper handles the voucher.
do $$ begin
  if to_regprocedure('public.complete_checkout_core(uuid,uuid,uuid,jsonb,public.payment_method,numeric,text,text,uuid,uuid)') is null then
    alter function public.complete_checkout(uuid,uuid,uuid,jsonb,public.payment_method,numeric,text,text,uuid,uuid) rename to complete_checkout_core;
  end if;
end $$;
revoke all on function public.complete_checkout_core(uuid,uuid,uuid,jsonb,public.payment_method,numeric,text,text,uuid,uuid) from public, anon, authenticated;

create or replace function public.complete_checkout(
  p_shift_id uuid, p_cashier_id uuid, p_outlet_id uuid, p_payload jsonb, p_payment_method public.payment_method,
  p_amount_received numeric, p_external_reference text, p_idempotency_key text,
  p_parent_transaction_id uuid default null, p_existing_transaction_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(btrim(coalesce(p_payload->>'voucher_code', '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb) - 'voucher_code';
  v public.vouchers;
  r public.voucher_redemptions;
  it jsonb;
  v_items jsonb := '[]'::jsonb;
  v_price numeric;
  v_qty numeric;
  v_gross numeric := 0;
  v_base numeric := 0;
  v_line numeric;
  v_matched integer := 0;
  v_amount numeric := 0;
  v_ids uuid[];
  res jsonb;
begin
  -- No voucher: exactly the old behaviour, including the idempotency hash of the payload.
  if v_code = '' then
    return public.complete_checkout_core(p_shift_id, p_cashier_id, p_outlet_id, v_payload, p_payment_method,
      p_amount_received, p_external_reference, p_idempotency_key, p_parent_transaction_id, p_existing_transaction_id);
  end if;

  perform public.assert_cashier(p_cashier_id, p_outlet_id);
  if coalesce(btrim(p_idempotency_key), '') = '' then raise exception 'ID pembayaran tidak valid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  -- Replay of a payment that already went through (offline queue, retry): same payload as the first time,
  -- so the core returns the same bill and the voucher is not counted twice.
  select * into r from public.voucher_redemptions where cashier_id = p_cashier_id and idempotency_key = p_idempotency_key;
  if found then
    return public.complete_checkout_core(p_shift_id, p_cashier_id, p_outlet_id, r.payload, p_payment_method,
      p_amount_received, p_external_reference, p_idempotency_key, p_parent_transaction_id, p_existing_transaction_id)
      || jsonb_build_object('voucherCode', v_code, 'voucherDiscount', r.amount);
  end if;

  if p_parent_transaction_id is not null then
    raise exception 'Voucher tidak bisa dipakai untuk pisah bill.' using errcode = 'P0001', hint = 'voucher_split';
  end if;

  v := public._032_find_voucher(p_outlet_id, v_code, true);
  select coalesce(array_agg(product_id), '{}') into v_ids from public.voucher_products where voucher_id = v.id;

  -- Prices come from the database, the same way the core reads them.
  for it in select * from jsonb_array_elements(coalesce(v_payload->'items', '[]'::jsonb)) loop
    v_qty := coalesce((it->>'quantity')::numeric, 0);
    select selling_price into v_price from public.products where id = (it->>'product_id')::uuid and outlet_id = p_outlet_id;
    v_price := coalesce(v_price, 0);
    v_line := v_price * v_qty;
    v_gross := v_gross + v_line;
    if v.scope = 'products' and (it->>'product_id')::uuid = any(v_ids) and v_line > 0 then
      if coalesce(it->>'discount_type', '') <> '' then
        raise exception 'Voucher produk tidak bisa digabung dengan diskon item pada menu yang sama. Hapus diskon itemnya dulu.'
          using errcode = 'P0001', hint = 'voucher_with_item_discount';
      end if;
      v_matched := v_matched + 1;
      it := it || jsonb_build_object('discount_type', v.discount_type,
        'discount_value', case when v.discount_type = 'amount' then least(v.value, v_line) else v.value end);
      v_amount := v_amount + public.calc_discount(v_line, v.discount_type,
        case when v.discount_type = 'amount' then least(v.value, v_line) else v.value end);
    end if;
    v_base := v_base + v_line - public.calc_discount(v_line, it->>'discount_type', (it->>'discount_value')::numeric);
    v_items := v_items || jsonb_build_array(it);
  end loop;

  if v_gross < v.min_spend then
    raise exception 'Belanja minimal Rp% untuk voucher ini.', to_char(v.min_spend, 'FM999G999G999G990')
      using errcode = 'P0001', hint = 'voucher_min_spend';
  end if;

  if v.scope = 'bill' then
    if coalesce(v_payload->>'bill_discount_type', '') <> '' then
      raise exception 'Voucher tidak bisa digabung dengan diskon bill. Hapus diskon bill dulu.' using errcode = 'P0001', hint = 'voucher_with_bill_discount';
    end if;
    if v.discount_type = 'amount' and v.value >= v_base then
      raise exception 'Potongan voucher lebih besar dari total bill.' using errcode = 'P0001', hint = 'voucher_too_large';
    end if;
    v_payload := v_payload || jsonb_build_object('bill_discount_type', v.discount_type, 'bill_discount_value', v.value);
    v_amount := public.calc_discount(v_base, v.discount_type, v.value);
  else
    if v_matched = 0 then
      raise exception 'Voucher ini hanya untuk menu tertentu, dan menu itu tidak ada di bill.' using errcode = 'P0001', hint = 'voucher_no_product';
    end if;
    v_payload := v_payload || jsonb_build_object('items', v_items);
  end if;

  res := public.complete_checkout_core(p_shift_id, p_cashier_id, p_outlet_id, v_payload, p_payment_method,
    p_amount_received, p_external_reference, p_idempotency_key, p_parent_transaction_id, p_existing_transaction_id);

  insert into public.voucher_redemptions(voucher_id, transaction_id, cashier_id, idempotency_key, payload, amount)
  values (v.id, (res->>'transactionId')::uuid, p_cashier_id, p_idempotency_key, v_payload, v_amount);
  update public.vouchers set used_count = used_count + 1 where id = v.id;

  return res || jsonb_build_object('voucherCode', v.code, 'voucherDiscount', v_amount);
end $$;
grant execute on function public.complete_checkout(uuid,uuid,uuid,jsonb,public.payment_method,numeric,text,text,uuid,uuid) to authenticated;

-- ---------------------------------------------------------------- 2. owner approval code for voids
-- The POS signs in with the owner's account, so the hash lives in a table clients cannot read at all.
-- Otherwise a cashier could fetch the hash and try all one million codes offline.
create table if not exists public.business_void_codes (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  code_hash text not null,
  failed integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.business_void_codes enable row level security;
revoke all on public.business_void_codes from anon, authenticated;

create or replace function public.owner_void_code_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('has_code', exists (select 1 from public.business_void_codes where business_id = public.require_owner_business()));
$$;
grant execute on function public.owner_void_code_status() to authenticated;

-- Set or change the code. Allowed while the subscription is expired too, so the owner is never stuck.
create or replace function public.owner_set_void_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := public.require_owner_business();
begin
  if coalesce(p_code, '') !~ '^[0-9]{6}$' then raise exception 'Kode persetujuan harus 6 digit angka.' using errcode = '22023'; end if;
  insert into public.business_void_codes(business_id, code_hash) values (b, crypt(p_code, gen_salt('bf')))
  on conflict (business_id) do update set code_hash = excluded.code_hash, failed = 0, locked_until = null, updated_at = now();
  return jsonb_build_object('has_code', true);
end $$;
grant execute on function public.owner_set_void_code(text) to authenticated;

-- Void with the owner's code. Wrong codes return a result instead of raising, so the attempt count is kept.
create or replace function public.void_transaction_approved(p_transaction_id uuid, p_reason text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.transactions%rowtype;
  vc public.business_void_codes%rowtype;
  b uuid;
  v_failed integer;
begin
  select * into t from public.transactions where id = p_transaction_id;
  if not found then raise exception 'Bill tidak ditemukan'; end if;
  perform public.assert_cashier(t.cashier_id, t.outlet_id);
  b := public.business_of_outlet(t.outlet_id);
  if not public.subscription_active(b) then perform public.raise_expired('membatalkan bill'); end if;
  select * into vc from public.business_void_codes where business_id = b for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_code'); end if;
  if vc.locked_until is not null and vc.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', vc.locked_until);
  end if;
  if coalesce(p_code, '') !~ '^[0-9]{6}$' or vc.code_hash <> crypt(p_code, vc.code_hash) then
    v_failed := vc.failed + 1;
    if v_failed >= 5 then
      update public.business_void_codes set failed = 0, locked_until = now() + interval '5 minutes' where business_id = b;
      return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', now() + interval '5 minutes');
    end if;
    update public.business_void_codes set failed = v_failed where business_id = b;
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'attempts_left', 5 - v_failed);
  end if;
  update public.business_void_codes set failed = 0, locked_until = null where business_id = b;
  return jsonb_build_object('ok', true) || public.void_transaction(p_transaction_id, p_reason);
end $$;
grant execute on function public.void_transaction_approved(uuid, text, text) to authenticated;
-- The plain function stays for the approved path and for the SQL Editor, but the app can no longer skip the code.
revoke execute on function public.void_transaction(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. cashier list with lock state
drop function if exists public.list_device_cashiers();
create function public.list_device_cashiers()
returns table(
  cashier_id uuid, cashier_name text, outlet_id uuid, outlet_name text,
  outlet_phone text, outlet_logo_url text, terminal_name text, has_pin boolean, pin_locked_until timestamptz
)
language sql stable security definer set search_path = public as $$
  select cs.cashier_id, cs.cashier_name, cs.outlet_id, coalesce(o.name, cs.outlet_name),
         o.phone, o.logo_url, cs.terminal_name, cs.pin_hash is not null,
         case when cs.pin_locked_until > now() then cs.pin_locked_until end
  from public.cashier_sessions cs
  left join public.outlets o on o.id = cs.outlet_id
  where cs.auth_user_id = auth.uid() and cs.is_active
  order by lower(cs.cashier_name);
$$;
grant execute on function public.list_device_cashiers() to authenticated;

-- ---------------------------------------------------------------- 4. save changes to a recalled held bill
-- Replaces the items, discounts, notes, and customer fields of a held bill with the cashier's cart. Prices and
-- cost come from the database, as in save_held_bill. Refused once part of the bill has been paid through
-- split bill, because those parts already took their share of the items.
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
    total_hpp = v_thpp
  where id = t.id;
  perform public.set_bill_totals(t.id, v_gross, v_idisc, p_payload->>'bill_discount_type', (p_payload->>'bill_discount_value')::numeric);
  return t.id;
end $$;
grant execute on function public.update_held_bill(uuid, jsonb) to authenticated;
