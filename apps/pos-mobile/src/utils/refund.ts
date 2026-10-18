import { TransactionItemSummary, TransactionSummary } from '../types/domain';

export type RefundLine = { qty: number; restock: boolean };
export const refundLeft = (i: TransactionItemSummary) => i.quantity - (i.refundedQty ?? 0);

/** Same split as refund_items_approved (migration 033), for the preview only: the server amount is the one that counts. */
export function estimateRefund(bill: TransactionSummary, items: TransactionItemSummary[], lines: Record<string, RefundLine>) {
  const net = items.reduce((n, i) => n + i.subtotal - i.discount, 0);
  const remaining = bill.total - (bill.refundedTotal ?? 0);
  const picked = items.some((i) => i.itemId && (lines[i.itemId]?.qty ?? 0) > 0);
  if (!picked) return 0;
  // The refund that empties the bill takes exactly what is left, so all refunds add up to the bill total.
  if (items.every((i) => !i.itemId || refundLeft(i) - (lines[i.itemId]?.qty ?? 0) <= 0)) return remaining;
  const est = items.reduce((n, i) => {
    const q = i.itemId ? (lines[i.itemId]?.qty ?? 0) : 0;
    return n + (q && net > 0 ? share(i.subtotal - i.discount, q, i.quantity, bill.total, net) : 0);
  }, 0);
  return Math.min(est, remaining);
}

/** round(lineNet * qty / quantity * total / net), half up, in exact integer math like the server's numeric (inputs up to 2 decimals). */
function share(lineNet: number, qty: number, quantity: number, total: number, net: number) {
  const cents = (x: number) => BigInt(Math.round(x * 100));
  const n = cents(lineNet) * cents(qty) * cents(total);
  const d = cents(quantity) * cents(net) * 100n;
  return Number((2n * n + d) / (2n * d));
}
