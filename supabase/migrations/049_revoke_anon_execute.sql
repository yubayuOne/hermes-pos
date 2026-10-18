-- HERMES POS 049: the signed-out role (anon) can no longer execute security definer functions.
-- Until now many of them (open_shift, complete_checkout, owner_set_void_code, ...) kept the default PUBLIC execute grant.
-- They all check auth.uid() inside, so nothing was exploitable, but an anonymous caller should not reach them at all.
-- Only anon and PUBLIC lose access. Whoever else could call a function keeps it: authenticated is granted again where it
-- had execute before, so functions that were already closed to authenticated stay closed.
-- username_available and plan_quote are public on purpose (sign-up form, landing prices).

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, has_function_privilege('authenticated', p.oid, 'execute') as for_users
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname not in ('username_available', 'plan_quote')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.for_users then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
