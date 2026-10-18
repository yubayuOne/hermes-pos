# HERMES POS Core — Test Runbook v2

This runbook validates the current hardened flow before further feature work.

## 0. Preconditions

- Apply migrations through `015_held_split_core_hardening.sql`.
- Use a disposable/test outlet and cashier.
- Start with an open shift.
- Have products with known stock and price.
- For concurrency tests, use two terminal sessions against the same database.

## 1. Payment Intent / Idempotency

### 1.1 Normal cash checkout
Expected:
- 1 completed transaction.
- 1 payment.
- Stock decremented exactly once.
- Cash ledger increases by net cash sale (`amount_received - change`).

### 1.2 Double tap
Submit the same payment intent twice with the same idempotency key.
Expected:
- Same `transactionId` returned both times.
- Exactly 1 transaction.
- Exactly 1 payment.
- Exactly 1 stock decrement.
- Exactly 1 cash-ledger payment entry.

### 1.3 Timeout after commit
Simulate a client timeout after the first RPC has committed, then retry with the same key.
Expected: same result as 1.2.

### 1.4 Same key, different payload
Reuse a completed idempotency key but change quantity, payment method, amount, or parent/existing transaction.
Expected error:
`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`

### 1.5 Concurrent same-key requests
Fire two identical checkout RPCs at nearly the same time.
Expected:
- One transaction only.
- Both calls resolve to the same transaction.
- No duplicate payment/stock/ledger mutation.

## 2. Transaction Core

### 2.1 Insufficient stock
Set stock lower than requested quantity.
Expected:
- RPC fails.
- No transaction/payment remains.
- Stock unchanged.

### 2.2 Inactive product
Deactivate a product before checkout.
Expected: checkout rejected; no partial mutation.

### 2.3 Closed shift
Close the shift, then attempt checkout.
Expected: checkout rejected.

### 2.4 Duplicate product lines in one request
Send the same `product_id` twice in one payload.
Expected:
- Quantities are aggregated.
- Stock is decremented once by the aggregate quantity.
- Split allocation uses aggregate quantity.

## 3. Held Bill

### 3.1 Hold
Hold a cart.
Expected:
- One `transactions` row with `status='held'`.
- One `held_bills` row.
- Transaction items contain price/HPP snapshots.
- Stock is unchanged.

### 3.2 Duplicate lines on hold
Send the same product twice while creating a held bill.
Expected: one transaction-item row for that product with aggregated quantity.

### 3.3 Price changes after hold
Hold at Rp5,000, then change catalog price to Rp6,000.
Recall/pay the held bill.
Expected: payment uses the stored Rp5,000 snapshot.

### 3.4 Stock changes after hold
Hold 3 units, then reduce current stock below 3.
Expected: payment fails and held bill remains active.

## 4. Split Bill

### 4.1 Partial split
Parent: product A × 3.
Child 1: product A × 1.
Expected:
- Child completed.
- Parent remains held.
- Parent remaining quantity = 2.
- Stock decremented by 1.

### 4.2 Complete split
Pay the final remaining quantity.
Expected:
- Final child completed.
- Parent becomes inactive/cancelled internally.
- `held_bills` row removed.
- Parent is not counted as a sale.

### 4.3 Over-allocation
Parent: product A × 3.
Attempt child allocation totaling 4.
Expected: rejected and no stock/payment mutation.

### 4.4 Concurrent split
Two terminals attempt to allocate the same remaining quantity from the same parent.
Expected: parent row lock serializes requests; total completed child quantity never exceeds parent quantity.

### 4.5 Parent price snapshot
Change product catalog price after parent hold.
Expected: child keeps parent's historical selling price/HPP.

### 4.6 Child retry
Retry a child checkout using the same idempotency key.
Expected: same child transaction returned; no second child.

## 5. Database Invariants

Run after the test suite:

```sql
-- Completed transaction must have exactly one payment.
select t.id, count(p.id) as payment_count
from public.transactions t
left join public.payments p on p.transaction_id = t.id
where t.status = 'completed'
group by t.id
having count(p.id) <> 1;
```

Expected: **0 rows**.

```sql
-- Stock must never be negative.
select id, name, stock
from public.products
where stock < 0;
```

Expected: **0 rows**.

```sql
-- No duplicate active held-bill link.
select transaction_id, count(*)
from public.held_bills
group by transaction_id
having count(*) > 1;
```

Expected: **0 rows**.

```sql
-- A completed child must never allocate more than its parent.
with parent_qty as (
  select transaction_id as parent_id, product_id, sum(quantity) qty
  from public.transaction_items
  group by transaction_id, product_id
), child_qty as (
  select t.parent_transaction_id parent_id, ti.product_id, sum(ti.quantity) qty
  from public.transaction_items ti
  join public.transactions t on t.id = ti.transaction_id
  where t.status = 'completed' and t.parent_transaction_id is not null
  group by t.parent_transaction_id, ti.product_id
)
select c.parent_id, c.product_id, c.qty, p.qty as parent_qty
from child_qty c
join parent_qty p
  on p.parent_id = c.parent_id and p.product_id = c.product_id
where c.qty > p.qty;
```

Expected: **0 rows**.

## Result rule

Do not continue to the next architecture phase if any invariant fails. Fix the database/RPC first, then rerun the affected scenario.
