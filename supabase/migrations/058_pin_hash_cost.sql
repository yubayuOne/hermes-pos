-- 058: stronger cashier PIN hashes (security audit, 17 Oct 2026; owner approved).
-- Since 052 the POS keeps every cashier's bcrypt hash on the phone for the offline PIN check. A 6-digit PIN has only a
-- million values, so at the default cost (6) a leaked hash is cracked in seconds. Cost 10 makes that 16 times slower.
-- New and changed PINs get cost 10 at once; an old hash is replaced on the next correct online PIN entry (the PIN is
-- known only then). The phones pick up the new hash with the next reference sync (its version changes).
-- Same bodies as 027 (owner_create_cashier, owner_set_cashier_pin) and 046 (verify_cashier_pin), only the hashing differs.

create or replace function public.owner_create_cashier(p_outlet_id uuid, p_name text, p_pin text, p_terminal text default 'POS 1')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := public.require_owner_business(); oname text; cid uuid;
begin
  if nullif(btrim(p_name), '') is null then raise exception 'Nama kasir wajib diisi'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then raise exception 'PIN harus 6 angka'; end if;
  select name into oname from public.outlets where id = p_outlet_id and business_id = b and is_active;
  if oname is null then raise exception 'Outlet tidak ditemukan'; end if;
  begin
    insert into public.cashier_sessions(auth_user_id, outlet_id, cashier_name, outlet_name, terminal_name, pin_hash)
    values (auth.uid(), p_outlet_id, btrim(p_name), oname, coalesce(nullif(btrim(coalesce(p_terminal, '')), ''), 'POS 1'), crypt(p_pin, gen_salt('bf', 10)))
    returning cashier_id into cid;
  exception when unique_violation then
    raise exception 'Nama kasir sudah dipakai';
  end;
  return cid;
end $$;
revoke all on function public.owner_create_cashier(uuid, text, text, text) from public, anon;
grant execute on function public.owner_create_cashier(uuid, text, text, text) to authenticated;

create or replace function public.owner_set_cashier_pin(p_cashier_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare b uuid := public.require_owner_business();
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then raise exception 'PIN harus 6 angka'; end if;
  update public.cashier_sessions
  set pin_hash = crypt(p_pin, gen_salt('bf', 10)), pin_failed_count = 0, pin_locked_until = null
  where cashier_id = p_cashier_id and auth_user_id = auth.uid()
    and outlet_id in (select id from public.outlets where business_id = b);
  if not found then raise exception 'Kasir tidak ditemukan'; end if;
end $$;
revoke all on function public.owner_set_cashier_pin(uuid, text) from public, anon;
grant execute on function public.owner_set_cashier_pin(uuid, text) to authenticated;

create or replace function public.verify_cashier_pin(p_cashier_id uuid, p_pin text, p_outlet_id uuid default null)
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
    -- "$2a$06$...": the two digits after the second $ are the cost. Below 10: rehash now that the PIN is known.
    update public.cashier_sessions
    set pin_failed_count = 0, pin_locked_until = null,
        pin_hash = case when substring(r.pin_hash from 5 for 2) ~ '^[0-9]{2}$' and substring(r.pin_hash from 5 for 2)::int < 10
                        then crypt(p_pin, gen_salt('bf', 10)) else pin_hash end
    where id = r.id;
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
