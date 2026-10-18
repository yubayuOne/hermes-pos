import { supabase } from '../supabase/client';
import { CartItem, CustomerInfo, Discount } from '../../types/domain';
import { billDiscountPayload, discountPayload } from '../../utils/discount';
import { cleanNote, notePayload } from '../../utils/note';
import { t } from '../../i18n';

/** Bill payload shared by hold, update, and checkout. Discounts are sent as type + value; the server computes them. */
export function billPayload(items: CartItem[], customer: CustomerInfo, billDiscount?: Discount | null) {
  return {
    items: items.map((i) => ({ product_id: i.productId, quantity: i.quantity, ...discountPayload(i.discount), ...notePayload(i.note) })),
    ...billDiscountPayload(billDiscount),
    customer_name: customer.name,
    customer_phone: customer.phone,
    table_number: customer.table,
  };
}

/**
 * Hold a bill. `idempotencyKey` makes a resend (e.g. from the offline queue) return the same bill
 * instead of a duplicate.
 */
export async function saveHeldBill(args: {
  shiftId: string;
  cashierId: string;
  outletId: string;
  items: CartItem[];
  customer: CustomerInfo;
  billDiscount?: Discount | null;
  idempotencyKey?: string;
  /** The phone's id and number for the bill (migration 054); without them the server numbers it. */
  transactionId?: string | null;
  number?: string | null;
}) {
  const base = {
    p_shift_id: args.shiftId,
    p_cashier_id: args.cashierId,
    p_outlet_id: args.outletId,
    p_payload: billPayload(args.items, args.customer, args.billDiscount),
    p_idempotency_key: args.idempotencyKey ?? null,
  };
  const { data, error } =
    args.transactionId && args.number
      ? await supabase.rpc('save_held_bill_v2', { ...base, p_transaction_id: args.transactionId, p_number: args.number })
      : await supabase.rpc('save_held_bill', base);
  if (error) throw error;
  return data as string;
}

export async function deleteHeldBill(transactionId: string) {
  const { error } = await supabase.rpc('delete_held_bill', { p_transaction_id: transactionId });
  if (error) throw error;
}

const toCartItem = (r: any): CartItem => ({
  productId: r.productId,
  name: r.name ?? t('Produk'),
  unitPrice: Number(r.unitPrice ?? 0),
  hpp: Number(r.hpp ?? 0),
  quantity: Number(r.quantity ?? 0),
  stock: Number(r.stock ?? 0),
  trackStock: r.trackStock !== false,
  station: (r.station ?? 'kitchen') as 'kitchen' | 'bar',
  discount: null,
  note: cleanNote(r.note) || null,
});

export type RecalledBill = { header: { customerName: string; customerPhone: string; tableNumber: string; billDiscount: Discount | null }; items: CartItem[] };

/** recall_held_bill_with_items's answer (also each entry of `held` in pos_shift_snapshot, 057). */
export function toRecalledBill(data: unknown): RecalledBill {
  const d: any = data ?? {};
  const items: CartItem[] = (d.items ?? []).map((r: any) => ({
    ...toCartItem(r),
    discount: r.discountType && Number(r.discountValue) > 0 ? ({ type: r.discountType, value: Number(r.discountValue) } as Discount) : null,
  }));
  const billDiscount: Discount | null =
    d.billDiscountType && Number(d.billDiscountValue) > 0 ? { type: d.billDiscountType, value: Number(d.billDiscountValue) } : null;
  return { header: { customerName: d.customerName ?? '', customerPhone: d.customerPhone ?? '', tableNumber: d.tableNumber ?? '', billDiscount }, items };
}

/** get_held_bill_items's rows as split lines, with the remaining discount per line (also inside pos_shift_snapshot, 057). */
export const toRemainingItems = (rows: unknown): Array<CartItem & { remainingDiscount: number }> =>
  ((rows as any[]) ?? []).map((r: any) => ({ ...toCartItem(r), remainingDiscount: Number(r.discountAmount ?? 0) }));

/** Recall a held bill with its remaining items in one request (RPC, migrations 017/023). Used to take 3 requests. */
export async function recallHeldBillWithItems(transactionId: string): Promise<RecalledBill> {
  const { data, error } = await supabase.rpc('recall_held_bill_with_items', { p_transaction_id: transactionId });
  if (error) throw error;
  return toRecalledBill(data);
}

/** Remaining items of a held bill or split-bill parent, with the remaining discount per line (for the split-bill screen). */
export async function fetchRemainingBillItems(transactionId: string): Promise<Array<CartItem & { remainingDiscount: number }>> {
  const { data, error } = await supabase.rpc('get_held_bill_items', { p_transaction_id: transactionId });
  if (error) throw error;
  return toRemainingItems(data);
}

/** Save the cashier's changes back into the recalled held bill (migration 032). Needs internet. */
export async function updateHeldBill(args: { transactionId: string; items: CartItem[]; customer: CustomerInfo; billDiscount?: Discount | null }) {
  const { error } = await supabase.rpc('update_held_bill', {
    p_transaction_id: args.transactionId,
    p_payload: billPayload(args.items, args.customer, args.billDiscount),
  });
  if (error) throw error;
}
