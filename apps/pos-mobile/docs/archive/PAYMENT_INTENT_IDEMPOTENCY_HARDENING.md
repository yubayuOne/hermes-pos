# Payment Intent & Idempotency Hardening

## What changed

- The payment screen no longer generates a fresh idempotency key on every `pay()` call.
- A payment intent is kept in `AppStore` using a fingerprint of the active checkout context.
- Retries of the same payment intent reuse the same idempotency key.
- Changing the checkout context creates a new payment intent.
- `checkout_idempotency.request_hash` records a server-side fingerprint of the request.
- PostgreSQL serializes requests sharing the same idempotency key with an advisory transaction lock.
- Reusing a key with a different request is rejected with `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`.

## Migration

Run migrations through the normal Supabase migration flow. The new migration is:

`supabase/migrations/013_payment_intent_idempotency.sql`

It preserves the existing `complete_checkout` RPC signature.

## Retry behavior

1. Cashier starts a payment intent.
2. HERMES POS generates one idempotency key.
3. Checkout succeeds in PostgreSQL but the response is lost.
4. Cashier retries.
5. The same key reaches `complete_checkout`.
6. PostgreSQL returns the already-created transaction instead of creating another one.

## Important limitation

The client payment intent is held in the running application state. A future offline/restart-hardening phase can persist pending intents if crash recovery across an app process restart is required.
