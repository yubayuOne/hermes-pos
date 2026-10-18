-- 054: bills made on the phone keep the phone's id and number (offline architecture, stage 2; owner's choice, 17 Oct 2026).
-- A bill paid or held offline gets its final id and number at once, so the receipt printed offline is final and a held
-- bill made offline can be recalled, changed, split and paid before it ever reaches the server.
--
-- Number format: #HPOS-YYYYMMDD-<terminal>-NNNN. Each phone is a terminal of the outlet with a short code (A1, A2, ...
-- B1); its own counter numbers its bills, so two phones never make the same number. The unique index on
-- transactions.number (001) stays the last guard.
--
-- How the id and number reach the row without rewriting the long checkout functions: the new *_v2 functions check them,
-- put them in two transaction-local settings, and call the existing function. A before-insert trigger on transactions
-- takes them for the one bill that function inserts, then clears them. Old app builds keep the old functions and the
-- server's own numbers.

-- ---------------------------------------------------------------- 1. terminals: one short code per phone and outlet
create table if not exists public.pos_terminals (
  device_id text not null,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  primary key (device_id, outlet_id),
  unique (outlet_id, code)
);
alter table public.pos_terminals enable row level security;
revoke all on public.pos_terminals from anon, authenticated;

/** The phone's terminal code at this outlet; a new phone gets the next one (A1..A9, B1..B9, ..., Z9). */
create or replace function public.register_terminal(p_outlet_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.request_device_id();
  v_code text;
  v_n integer;
begin
  if v_me is null then raise exception 'ID perangkat tidak terkirim. Perbarui aplikasi.'; end if;
  if not exists (select 1 from public.cashier_sessions cs where cs.auth_user_id = auth.uid() and cs.outlet_id = p_outlet_id and cs.is_active) then
    raise exception 'Outlet tidak ditemukan';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('terminal:' || p_outlet_id::text, 0));
  select t.code into v_code from public.pos_terminals t where t.device_id = v_me and t.outlet_id = p_outlet_id;
  if v_code is not null then return v_code; end if;
  select count(*) into v_n from public.pos_terminals t where t.outlet_id = p_outlet_id;
  if v_n >= 26 * 9 then raise exception 'Batas perangkat outlet ini tercapai'; end if;
  v_code := chr(65 + v_n / 9) || ((v_n % 9) + 1)::text;
  insert into public.pos_terminals (device_id, outlet_id, code) values (v_me, p_outlet_id, v_code);
  return v_code;
end;
$$;
revoke all on function public.register_terminal(uuid) from public, anon;
grant execute on function public.register_terminal(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. the id and number the phone made
/** Raises unless `p_number` is this phone's terminal number at this outlet and the id is new. */
create or replace function public.assert_device_bill(p_outlet_id uuid, p_transaction_id uuid, p_number text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_code text;
begin
  if p_transaction_id is null then raise exception 'ID bill tidak valid'; end if;
  select t.code into v_code from public.pos_terminals t where t.device_id = public.request_device_id() and t.outlet_id = p_outlet_id;
  if v_code is null then raise exception 'Perangkat belum terdaftar di outlet ini'; end if;
  if coalesce(p_number, '') !~ ('^#HPOS-[0-9]{8}-' || v_code || '-[0-9]{4,6}$') then raise exception 'Nomor bill tidak valid'; end if;
end;
$$;
revoke all on function public.assert_device_bill(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.trg_transaction_client_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_id text := nullif(current_setting('hermes.client_tx_id', true), '');
  v_number text := nullif(current_setting('hermes.client_tx_number', true), '');
begin
  if v_id is not null then
    new.id := v_id::uuid;
    new.number := v_number;
    -- One bill per call: a second insert in the same request gets the server's own id and number.
    perform set_config('hermes.client_tx_id', '', true);
    perform set_config('hermes.client_tx_number', '', true);
  end if;
  return new;
end;
$$;
drop trigger if exists transaction_client_id on public.transactions;
create trigger transaction_client_id before insert on public.transactions for each row execute function public.trg_transaction_client_id();

-- ---------------------------------------------------------------- 3. checkout and hold with the phone's id and number
create or replace function public.complete_checkout_v2(
  p_shift_id uuid, p_cashier_id uuid, p_outlet_id uuid, p_payload jsonb, p_payment_method public.payment_method,
  p_amount_received numeric, p_external_reference text, p_idempotency_key text,
  p_parent_transaction_id uuid default null, p_existing_transaction_id uuid default null,
  p_transaction_id uuid default null, p_number text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Paying a held bill inserts no new bill: it keeps the number it got when it was held.
  if p_existing_transaction_id is null and p_transaction_id is not null then
    perform public.assert_device_bill(p_outlet_id, p_transaction_id, p_number);
    perform set_config('hermes.client_tx_id', p_transaction_id::text, true);
    perform set_config('hermes.client_tx_number', p_number, true);
  end if;
  return public.complete_checkout(p_shift_id, p_cashier_id, p_outlet_id, p_payload, p_payment_method, p_amount_received,
    p_external_reference, p_idempotency_key, p_parent_transaction_id, p_existing_transaction_id);
end;
$$;
revoke all on function public.complete_checkout_v2(uuid, uuid, uuid, jsonb, public.payment_method, numeric, text, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.complete_checkout_v2(uuid, uuid, uuid, jsonb, public.payment_method, numeric, text, text, uuid, uuid, uuid, text) to authenticated;

create or replace function public.save_held_bill_v2(
  p_shift_id uuid, p_cashier_id uuid, p_outlet_id uuid, p_payload jsonb, p_idempotency_key text,
  p_transaction_id uuid, p_number text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_device_bill(p_outlet_id, p_transaction_id, p_number);
  perform set_config('hermes.client_tx_id', p_transaction_id::text, true);
  perform set_config('hermes.client_tx_number', p_number, true);
  return public.save_held_bill(p_shift_id, p_cashier_id, p_outlet_id, p_payload, p_idempotency_key);
end;
$$;
revoke all on function public.save_held_bill_v2(uuid, uuid, uuid, jsonb, text, uuid, text) from public, anon;
grant execute on function public.save_held_bill_v2(uuid, uuid, uuid, jsonb, text, uuid, text) to authenticated;
