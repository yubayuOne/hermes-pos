-- Defense in depth (OWASP A01): checkout_idempotency is the only public table without row level security. Clients
-- have no privileges on it since 001, but a later grant would expose every cashier's payment keys. With RLS on and no
-- policy, clients see nothing even then; the security definer checkout functions own the table and are unaffected.
alter table public.checkout_idempotency enable row level security;
