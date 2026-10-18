-- HERMES POS 047: each outlet has its own address on the receipt and, if it wants, its own header and footer text.
--  * outlets.receipt_header / receipt_footer: empty means "use the business text" (businesses.receipt).
--  * owner_update_outlet takes both. For these two, null keeps the stored value and '' clears it, so older callers
--    (onboarding) that pass only five arguments change nothing else.
--  * list_device_cashiers returns the outlet address, header, and footer to the POS.

alter table public.outlets
  add column if not exists receipt_header text check (receipt_header is null or char_length(receipt_header) <= 120),
  add column if not exists receipt_footer text check (receipt_footer is null or char_length(receipt_footer) <= 120);

drop function if exists public.owner_update_outlet(uuid, text, text, text, boolean);
create function public.owner_update_outlet(
  p_outlet_id uuid, p_name text, p_address text default null, p_phone text default null, p_is_active boolean default true,
  p_receipt_header text default null, p_receipt_footer text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.require_owner_business();
begin
  if nullif(btrim(p_name), '') is null then raise exception 'Nama outlet wajib diisi'; end if;
  if char_length(btrim(coalesce(p_receipt_header, ''))) > 120 or char_length(btrim(coalesce(p_receipt_footer, ''))) > 120 then
    raise exception 'Teks struk maksimal 120 karakter' using errcode = '22023';
  end if;
  update public.outlets
  set name = btrim(p_name),
      address = nullif(btrim(coalesce(p_address, '')), ''),
      phone = nullif(btrim(coalesce(p_phone, '')), ''),
      is_active = coalesce(p_is_active, true),
      receipt_header = case when p_receipt_header is null then receipt_header else nullif(btrim(p_receipt_header), '') end,
      receipt_footer = case when p_receipt_footer is null then receipt_footer else nullif(btrim(p_receipt_footer), '') end
  where id = p_outlet_id and business_id = b;
  if not found then raise exception 'Outlet tidak ditemukan'; end if;
  -- The outlet name is copied to the cashier rows (outlet_name) so the POS shows the new name.
  update public.cashier_sessions set outlet_name = btrim(p_name) where outlet_id = p_outlet_id;
end $$;
revoke all on function public.owner_update_outlet(uuid, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.owner_update_outlet(uuid, text, text, text, boolean, text, text) to authenticated;

drop function if exists public.list_device_cashiers(uuid);
create function public.list_device_cashiers(p_outlet_id uuid default null)
returns table(
  cashier_id uuid, cashier_name text, outlet_id uuid, outlet_name text,
  outlet_phone text, outlet_logo_url text, terminal_name text, has_pin boolean, pin_locked_until timestamptz,
  outlet_logo_print_url text, outlet_address text, outlet_receipt_header text, outlet_receipt_footer text
)
language sql stable security definer set search_path = public as $$
  select cs.cashier_id, cs.cashier_name, cs.outlet_id, coalesce(o.name, cs.outlet_name),
         o.phone, o.logo_url, cs.terminal_name, cs.pin_hash is not null,
         case when cs.pin_locked_until > now() then cs.pin_locked_until end,
         o.logo_print_url, o.address, o.receipt_header, o.receipt_footer
  from public.cashier_sessions cs
  left join public.outlets o on o.id = cs.outlet_id
  where cs.auth_user_id = auth.uid() and cs.is_active
    and (p_outlet_id is null or cs.outlet_id = p_outlet_id)
  order by lower(cs.cashier_name);
$$;
revoke all on function public.list_device_cashiers(uuid) from public, anon;
grant execute on function public.list_device_cashiers(uuid) to authenticated;
