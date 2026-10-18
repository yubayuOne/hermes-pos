-- HERMES POS 046: a phone belongs to one outlet.
-- The POS remembers the outlet chosen at first sign-in and sends it as p_outlet_id. Then list_device_cashiers shows only
-- that outlet's cashiers and verify_cashier_pin refuses a cashier of another outlet ('not_found'; it does not touch the
-- failed-PIN counter). null keeps the old behaviour so an app that is not updated yet still works.

drop function if exists public.list_device_cashiers();
create function public.list_device_cashiers(p_outlet_id uuid default null)
returns table(
  cashier_id uuid, cashier_name text, outlet_id uuid, outlet_name text,
  outlet_phone text, outlet_logo_url text, terminal_name text, has_pin boolean, pin_locked_until timestamptz,
  outlet_logo_print_url text
)
language sql stable security definer set search_path = public as $$
  select cs.cashier_id, cs.cashier_name, cs.outlet_id, coalesce(o.name, cs.outlet_name),
         o.phone, o.logo_url, cs.terminal_name, cs.pin_hash is not null,
         case when cs.pin_locked_until > now() then cs.pin_locked_until end,
         o.logo_print_url
  from public.cashier_sessions cs
  left join public.outlets o on o.id = cs.outlet_id
  where cs.auth_user_id = auth.uid() and cs.is_active
    and (p_outlet_id is null or cs.outlet_id = p_outlet_id)
  order by lower(cs.cashier_name);
$$;
revoke all on function public.list_device_cashiers(uuid) from public, anon;
grant execute on function public.list_device_cashiers(uuid) to authenticated;

drop function if exists public.verify_cashier_pin(uuid, text);
create function public.verify_cashier_pin(p_cashier_id uuid, p_pin text, p_outlet_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.cashier_sessions%rowtype;
  failed integer;
begin
  select * into r from public.cashier_sessions
  where auth_user_id = auth.uid() and cashier_id = p_cashier_id and is_active
    and (p_outlet_id is null or outlet_id = p_outlet_id)
  for update;

  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.pin_hash is null then return jsonb_build_object('ok', false, 'reason', 'no_pin'); end if;

  if r.pin_locked_until is not null and r.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', r.pin_locked_until);
  end if;

  if r.pin_hash = crypt(coalesce(p_pin, ''), r.pin_hash) then
    update public.cashier_sessions set pin_failed_count = 0, pin_locked_until = null where id = r.id;
    return jsonb_build_object('ok', true);
  end if;

  failed := r.pin_failed_count + 1;
  if failed >= 5 then
    update public.cashier_sessions set pin_failed_count = 0, pin_locked_until = now() + interval '5 minutes' where id = r.id;
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', now() + interval '5 minutes');
  end if;
  update public.cashier_sessions set pin_failed_count = failed where id = r.id;
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'attempts_left', 5 - failed);
end $$;
revoke all on function public.verify_cashier_pin(uuid, text, uuid) from public, anon;
grant execute on function public.verify_cashier_pin(uuid, text, uuid) to authenticated;
