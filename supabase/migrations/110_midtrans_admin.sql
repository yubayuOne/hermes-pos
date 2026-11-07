-- 110: Midtrans (Snap) pays the subscription; manual bank transfer ends (owner's request, 7 Nov 2026).
-- Payments keep their table (payment_confirmations): a Midtrans order is a row with provider 'midtrans', status 'pending'
-- until Midtrans reports settlement to the webhook. Its invoice number is the Midtrans order id.
-- A platform admin (listed in admin_users) sees every payment and can verify or reject a manual transfer.

alter table public.payment_confirmations
  add column if not exists provider text not null default 'manual' check (provider in ('manual', 'midtrans')),
  add column if not exists payment_url text,
  add column if not exists midtrans_transaction_id text;
-- A Midtrans order has no transfer details and no paid amount until it is settled.
alter table public.payment_confirmations
  alter column sender_name drop not null, alter column bank_name drop not null,
  alter column transfer_date drop not null, alter column amount_paid drop not null;
alter table public.payment_confirmations drop constraint if exists payment_confirmations_status_check;
alter table public.payment_confirmations add constraint payment_confirmations_status_check
  check (status in ('pending', 'submitted', 'verified', 'rejected'));
drop index if exists public.payment_one_pending;
create unique index if not exists payment_one_open on public.payment_confirmations(business_id) where status in ('pending', 'submitted');

-- Manual transfers are over: the owner can no longer submit one.
revoke all on function public.owner_submit_payment(text, integer, text, text, date, bigint, text) from authenticated;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from public, anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid())
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- The owner starts paying with Midtrans. Reuses the open order for the same plan; a different plan replaces it.
create or replace function public.owner_begin_midtrans(p_plan_code text, p_extra_outlets integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := public.require_owner_business();
  v_due bigint := public.plan_quote(p_plan_code, coalesce(p_extra_outlets, 0));
  v_row public.payment_confirmations;
  v_name text;
begin
  if not public.subscription_active(b) and not exists (select 1 from public.subscriptions where business_id = b) then
    raise exception 'Langganan tidak ditemukan.' using errcode = 'P0002';
  end if;
  select * into v_row from public.payment_confirmations where business_id = b and status = 'pending' and provider = 'midtrans' for update;
  if v_row.id is not null and v_row.plan_code = p_plan_code and v_row.extra_outlets = coalesce(p_extra_outlets, 0) then
    null; -- same order again
  else
    if exists (select 1 from public.payment_confirmations where business_id = b and status = 'submitted') then
      raise exception 'Masih ada konfirmasi transfer yang sedang diperiksa.' using errcode = '23505';
    end if;
    if v_row.id is not null then
      update public.payment_confirmations set status = 'rejected', reject_reason = 'Paket diganti', decided_at = now() where id = v_row.id;
    end if;
    insert into public.payment_confirmations(business_id, invoice_number, plan_code, extra_outlets, amount_due, provider, status)
    values (b, 'INV-' || to_char((now() at time zone 'Asia/Jakarta')::date, 'YYYYMMDD') || '-' || lpad(nextval('public.invoice_seq')::text, 5, '0'),
      p_plan_code, coalesce(p_extra_outlets, 0), v_due, 'midtrans', 'pending')
    returning * into v_row;
  end if;
  select name into v_name from public.businesses where id = b;
  return jsonb_build_object('invoice', v_row.invoice_number, 'amount', v_row.amount_due, 'paymentUrl', v_row.payment_url,
    'business', v_name, 'status', v_row.status);
end $$;
revoke all on function public.owner_begin_midtrans(text, integer) from public, anon;
grant execute on function public.owner_begin_midtrans(text, integer) to authenticated;

-- Server only (service role): keeps the Snap page address of an order, so a reload reuses it.
create or replace function public.midtrans_save_payment_url(p_invoice text, p_url text)
returns void language sql security definer set search_path = public as $$
  update public.payment_confirmations set payment_url = p_url
  where invoice_number = p_invoice and provider = 'midtrans' and status = 'pending' and payment_url is null
$$;
revoke all on function public.midtrans_save_payment_url(text, text) from public, anon, authenticated;
grant execute on function public.midtrans_save_payment_url(text, text) to service_role;

-- Server only (service role): the webhook's verified notification. Settlement with the quoted amount activates the plan
-- once; any later notice for the same order changes nothing. A settlement for an order the owner has since replaced
-- still activates it, because the money arrived.
create or replace function public.midtrans_settle(p_invoice text, p_transaction_id text, p_status text, p_gross bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.payment_confirmations; v_expires timestamptz;
begin
  select * into v_row from public.payment_confirmations where invoice_number = p_invoice and provider = 'midtrans' for update;
  if v_row.id is null then raise exception 'Pesanan tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_row.status = 'verified' then return jsonb_build_object('changed', false); end if;
  if p_status = 'settlement' then
    if p_gross is distinct from v_row.amount_due then raise exception 'Jumlah pembayaran tidak sesuai.' using errcode = '22023'; end if;
    perform public.admin_activate_subscription(v_row.business_id, v_row.plan_code, v_row.extra_outlets);
    select expires_at into v_expires from public.subscriptions where business_id = v_row.business_id;
    update public.payment_confirmations set status = 'verified', amount_paid = p_gross, midtrans_transaction_id = p_transaction_id,
      new_expires_at = v_expires, decided_at = now()
    where id = v_row.id;
    return jsonb_build_object('changed', true);
  end if;
  if p_status in ('deny', 'cancel', 'expire', 'failure') and v_row.status in ('pending', 'rejected') then
    update public.payment_confirmations set status = 'rejected', reject_reason = 'Midtrans: ' || p_status, midtrans_transaction_id = p_transaction_id,
      decided_at = now()
    where id = v_row.id and status = 'pending';
    return jsonb_build_object('changed', true);
  end if;
  return jsonb_build_object('changed', false);
end $$;
revoke all on function public.midtrans_settle(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.midtrans_settle(text, text, text, bigint) to service_role;

-- Admin pages: every business's payments, newest first, 20 a page. Only platform admins.
create or replace function public.admin_list_payments(p_status text default null, p_page integer default 1)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare off integer := (greatest(coalesce(p_page, 1), 1) - 1) * 20;
begin
  if not public.is_platform_admin() then raise exception 'Hanya admin platform.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.payment_confirmations p where p_status is null or p.status = p_status),
    'rows', coalesce((
      select jsonb_agg(x order by x.created_at desc)
      from (
        select p.created_at, jsonb_build_object('id', p.id, 'invoice', p.invoice_number, 'provider', p.provider, 'business', b.name,
          'plan', p.plan_code, 'extraOutlets', p.extra_outlets, 'amountDue', p.amount_due, 'amountPaid', p.amount_paid,
          'status', p.status, 'rejectReason', p.reject_reason, 'createdAt', p.created_at, 'decidedAt', p.decided_at,
          'senderName', p.sender_name, 'bank', p.bank_name, 'transferDate', p.transfer_date) as x
        from public.payment_confirmations p join public.businesses b on b.id = p.business_id
        where p_status is null or p.status = p_status
        order by p.created_at desc, p.id
        limit 20 offset off
      ) x
    ), '[]'::jsonb));
end $$;
revoke all on function public.admin_list_payments(text, integer) from public, anon;
grant execute on function public.admin_list_payments(text, integer) to authenticated;

-- Manual transfers: a platform admin verifies or rejects (the functions of 031, now for admins signed in).
create or replace function public.admin_verify_payment(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.payment_confirmations; v_expires timestamptz;
begin
  if not public.is_platform_admin() then raise exception 'Hanya admin platform.' using errcode = '42501'; end if;
  select * into v_row from public.payment_confirmations where id = p_id for update;
  if v_row.id is null then raise exception 'Konfirmasi pembayaran tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_row.status <> 'submitted' then raise exception 'Konfirmasi ini sudah diproses.' using errcode = '23505'; end if;
  perform public.admin_activate_subscription(v_row.business_id, v_row.plan_code, v_row.extra_outlets);
  select expires_at into v_expires from public.subscriptions where business_id = v_row.business_id;
  update public.payment_confirmations set status = 'verified', new_expires_at = v_expires, decided_at = now()
  where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end $$;
create or replace function public.admin_reject_payment(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.payment_confirmations;
begin
  if not public.is_platform_admin() then raise exception 'Hanya admin platform.' using errcode = '42501'; end if;
  update public.payment_confirmations set status = 'rejected', reject_reason = left(trim(coalesce(p_reason, '')), 200), decided_at = now()
  where id = p_id and status = 'submitted' returning * into v_row;
  if v_row.id is null then raise exception 'Konfirmasi tidak ditemukan atau sudah diproses.' using errcode = 'P0002'; end if;
  return to_jsonb(v_row);
end $$;
revoke all on function public.admin_verify_payment(uuid) from public, anon;
revoke all on function public.admin_reject_payment(uuid, text) from public, anon;
grant execute on function public.admin_verify_payment(uuid) to authenticated;
grant execute on function public.admin_reject_payment(uuid, text) to authenticated;
