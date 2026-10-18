# HERMES POS — Hotfix Recalled Held Bill + Added Cart Items

## Bug
After recalling a Held Bill, the cashier could add more products. The payment screen calculated the combined cart total correctly, but `complete_checkout()` paid only the old `transaction_items` stored in the Held Bill because the existing-transaction branch ignored `p_payload`.

## Fix
Migration `016_held_recalled_cart_merge.sql` re-applies the hardened checkout function and reconciles the current cart (`p_payload`) against the held transaction snapshot before payment.

Rules:
- `p_payload` is the desired final cart.
- Existing held quantity keeps its historical `selling_price_unit` and `hpp_unit`.
- Quantity added after recall uses the current catalog `selling_price` and `hpp` as a new snapshot.
- Duplicate product IDs in the current cart are aggregated.
- Product rows are locked in deterministic order before stock validation/update.
- Stock is decremented only for the final desired quantity at payment time.
- Transaction totals and payment are recalculated from the reconciled database snapshot.
- Customer/table fields are updated from the current cart context.
- The Held Bill row is removed only after successful payment within the same transaction.

## Test case
1. Create a Held Bill with A x1.
2. Recall the Held Bill.
3. Add B x2 to the cart.
4. Open Payment.
5. Confirm the UI total is A x1 + B x2.
6. Pay.
7. Verify `transactions.total` equals A x1 + B x2.
8. Verify `transaction_items` contains A x1 and B x2.
9. Verify stock decreased by A x1 and B x2.
10. Verify `payments.amount_received` matches the final total.
11. Verify the Held Bill is no longer active.

## Regression cases
- Recall and pay without adding items: total remains unchanged.
- Add more quantity of an existing product: only the additional quantity uses current catalog price; original held quantity keeps its snapshot price.
- Reduce an existing held quantity before payment: final transaction follows the current cart quantity.
- Add a brand-new product after recall: it is inserted into `transaction_items` before completion.
- Insufficient stock for the final cart: the whole checkout rolls back.
