-- Owner bill edits (066) leave a trail, and a voided bill gives its voucher use back.
--
-- 1) transaction_edits: one row per owner edit with the reason and the bill before and after. Item and payment changes
--    need a reason now, like a void. The 066 functions become internal workers; the public names wrap them, lock the
--    bill, take the snapshots, and write the row in the same transaction. Read only through owner_list_bill_edits.
-- 2) owner_list_bills rows carry editCount, so edited bills are marked in the list.
-- 3) A bill that goes from completed to voided (POS or backoffice) lowers its voucher's used_count once.

create table if not exists public.transaction_edits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  edited_by uuid,
  kind text not null check (kind in ('void', 'payment', 'details', 'items')),
  reason text,
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists transaction_edits_tx on public.transaction_edits(transaction_id, created_at);
alter table public.transaction_edits enable row level security;
revoke all on public.transaction_edits from public, anon, authenticated;

alter function public.owner_void_bill(uuid, text) rename to _066_void_bill;
alter function public.owner_set_bill_payment(uuid, public.payment_method) rename to _066_set_bill_payment;
alter function public.owner_update_bill_details(uuid, text, text, jsonb) rename to _066_update_bill_details;
alter function public.owner_update_bill_items(uuid, jsonb) rename to _066_update_bill_items;
revoke all on function public._066_void_bill(uuid, text) from public, anon, authenticated;
revoke all on function public._066_set_bill_payment(uuid, public.payment_method) from public, anon, authenticated;
revoke all on function public._066_update_bill_details(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._066_update_bill_items(uuid, jsonb) from public, anon, authenticated;

-- The bill as the owner sees it, for the log. Internal.
create or replace function public._067_snapshot(p_transaction_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'status', t.status::text, 'total', t.total, 'paymentMethod', t.payment_method::text,
    'customerName', t.customer_name, 'tableNumber', t.table_number,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('productName', p.name, 'quantity', ti.quantity, 'unitPrice', ti.selling_price_unit,
        'discount', ti.discount_amount, 'note', ti.note) order by p.name, ti.id)
      from public.transaction_items ti join public.products p on p.id = ti.product_id
      where ti.transaction_id = t.id), '[]'::jsonb))
  from public.transactions t where t.id = p_transaction_id
$$;
revoke all on function public._067_snapshot(uuid) from public, anon, authenticated;

-- Checks the owner, then locks shift and bill in the workers' order, and returns the bill before the edit. Internal.
create or replace function public._067_begin(p_transaction_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_outlet uuid; v_shift uuid;
begin
  select outlet_id, shift_id into v_outlet, v_shift from public.transactions where id = p_transaction_id;
  if not found or not public.is_owner_of_outlet(v_outlet) then raise exception 'Bill tidak ditemukan'; end if;
  perform 1 from public.shifts where id = v_shift for update;
  perform 1 from public.transactions where id = p_transaction_id for update;
  return public._067_snapshot(p_transaction_id);
end $$;
revoke all on function public._067_begin(uuid) from public, anon, authenticated;

create or replace function public._067_log(p_transaction_id uuid, p_kind text, p_reason text, p_before jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into public.transaction_edits(transaction_id, edited_by, kind, reason, before, after)
  values (p_transaction_id, auth.uid(), p_kind, nullif(btrim(coalesce(p_reason, '')), ''), p_before, public._067_snapshot(p_transaction_id));
$$;
revoke all on function public._067_log(uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public._067_reason(p_reason text)
returns text
language plpgsql immutable as $$
declare v text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v) < 3 then raise exception 'Alasan perubahan wajib diisi, minimal 3 karakter'; end if;
  if char_length(v) > 200 then raise exception 'Alasan maksimal 200 karakter'; end if;
  return v;
end $$;

create or replace function public.owner_void_bill(p_transaction_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before jsonb := public._067_begin(p_transaction_id); res jsonb;
begin
  res := public._066_void_bill(p_transaction_id, p_reason);
  perform public._067_log(p_transaction_id, 'void', p_reason, v_before);
  return res;
end $$;

create or replace function public.owner_set_bill_payment(p_transaction_id uuid, p_method public.payment_method, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_reason text := public._067_reason(p_reason); v_before jsonb := public._067_begin(p_transaction_id); res jsonb;
begin
  res := public._066_set_bill_payment(p_transaction_id, p_method);
  if v_before ->> 'paymentMethod' is distinct from p_method::text then
    perform public._067_log(p_transaction_id, 'payment', v_reason, v_before);
  end if;
  return res;
end $$;

create or replace function public.owner_update_bill_details(p_transaction_id uuid, p_customer_name text, p_table_number text, p_notes jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before jsonb := public._067_begin(p_transaction_id); res jsonb;
begin
  res := public._066_update_bill_details(p_transaction_id, p_customer_name, p_table_number, p_notes);
  if public._067_snapshot(p_transaction_id) is distinct from v_before then
    perform public._067_log(p_transaction_id, 'details', null, v_before);
  end if;
  return res;
end $$;

create or replace function public.owner_update_bill_items(p_transaction_id uuid, p_items jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_reason text := public._067_reason(p_reason); v_before jsonb := public._067_begin(p_transaction_id); res jsonb;
begin
  res := public._066_update_bill_items(p_transaction_id, p_items);
  perform public._067_log(p_transaction_id, 'items', v_reason, v_before);
  return res;
end $$;

-- Oldest first: [{ id, createdAt, kind, reason, before, after }].
create or replace function public.owner_list_bill_edits(p_transaction_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_outlet uuid;
begin
  perform public.require_owner_business();
  select outlet_id into v_outlet from public.transactions where id = p_transaction_id;
  if not found or not public.is_owner_of_outlet(v_outlet) then raise exception 'Bill tidak ditemukan'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'createdAt', e.created_at, 'kind', e.kind, 'reason', e.reason,
      'before', e.before, 'after', e.after) order by e.created_at, e.id)
    from public.transaction_edits e where e.transaction_id = p_transaction_id
  ), '[]'::jsonb);
end $$;

revoke all on function public.owner_void_bill(uuid, text) from public, anon;
revoke all on function public.owner_set_bill_payment(uuid, public.payment_method, text) from public, anon;
revoke all on function public.owner_update_bill_details(uuid, text, text, jsonb) from public, anon;
revoke all on function public.owner_update_bill_items(uuid, jsonb, text) from public, anon;
revoke all on function public.owner_list_bill_edits(uuid) from public, anon;
grant execute on function public.owner_void_bill(uuid, text) to authenticated;
grant execute on function public.owner_set_bill_payment(uuid, public.payment_method, text) to authenticated;
grant execute on function public.owner_update_bill_details(uuid, text, text, jsonb) to authenticated;
grant execute on function public.owner_update_bill_items(uuid, jsonb, text) to authenticated;
grant execute on function public.owner_list_bill_edits(uuid) to authenticated;

-- Same as before plus editCount.
create or replace function public.owner_list_bills(p_outlet_id uuid, p_from timestamptz, p_to timestamptz, p_status text default 'completed',
  p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.require_owner_business(); lim integer; off integer; q text; result jsonb;
begin
  if p_outlet_id is not null and not public.is_owner_of_outlet(p_outlet_id) then raise exception 'Outlet tidak ditemukan'; end if;
  if p_to <= p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_status not in ('completed', 'held', 'voided', 'all') then raise exception 'Status bill tidak valid'; end if;
  lim := least(greatest(coalesce(p_limit, 50), 1), 200);
  off := greatest(coalesce(p_offset, 0), 0);
  q := nullif(btrim(coalesce(p_search, '')), '');

  with f as (
    select t.* from public.transactions t join public.outlets o on o.id = t.outlet_id
    where o.business_id = b and (p_outlet_id is null or o.id = p_outlet_id)
      and t.created_at >= p_from and t.created_at < p_to
      and t.status::text not in ('draft', 'split')
      and (p_status = 'all' or t.status::text = p_status)
      and (q is null or t.number ilike '%' || q || '%' or t.customer_name ilike '%' || q || '%' or t.table_number ilike '%' || q || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'number', r.number, 'status', r.status::text, 'total', r.total, 'paymentMethod', r.payment_method::text,
        'createdAt', r.created_at, 'customerName', r.customer_name, 'tableNumber', r.table_number,
        'outletId', r.outlet_id, 'outletName', r.outlet_name, 'cashierName', r.cashier_name,
        'voidReason', r.void_reason, 'discount', r.discount, 'refundedTotal', r.refunded_total,
        'editCount', (select count(*) from public.transaction_edits e where e.transaction_id = r.id)) order by r.created_at desc, r.id)
      from (
        select f.id, f.number, f.status, f.total, f.payment_method, f.created_at, f.customer_name, f.table_number,
               f.outlet_id, o.name as outlet_name, coalesce(cs.cashier_name, 'Kasir dihapus') as cashier_name,
               f.void_reason, f.item_discount + f.bill_discount as discount, f.refunded_total
        from f
        join public.outlets o on o.id = f.outlet_id
        left join public.cashier_sessions cs on cs.cashier_id = f.cashier_id
        order by f.created_at desc, f.id
        limit lim offset off
      ) r
    ), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- A voided bill gives its voucher use back. The status leaves 'completed' only once, so this runs once per bill; the
-- redemption row stays, so an offline replay of the original payment still finds it and does not count it again.
create or replace function public.trg_release_voucher()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.vouchers v set used_count = greatest(v.used_count - 1, 0)
  from public.voucher_redemptions r
  where r.transaction_id = new.id and r.voucher_id = v.id;
  return new;
end $$;
revoke all on function public.trg_release_voucher() from public, anon, authenticated;
drop trigger if exists transaction_release_voucher on public.transactions;
create trigger transaction_release_voucher
  after update of status on public.transactions
  for each row when (old.status = 'completed' and new.status = 'voided')
  execute function public.trg_release_voucher();
