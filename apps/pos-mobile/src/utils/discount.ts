import { t } from '../i18n';
import { CartItem, Discount } from '../types/domain';

/**
 * Discount formula. MUST match public.calc_discount() in the database (migration 023):
 * - percent: round(base x percent / 100), rounded to whole rupiah (half up), max 100%
 * - amount : rupiah amount for the whole base, never more than the base
 * Percent is computed with integers (percent x 100) to avoid JavaScript decimal errors.
 * The server decides; this is only for display and the amount-received check at the till.
 */
export function calcDiscount(base: number, d?: Discount | null): number {
  if (!d || !(d.value > 0) || !(base > 0)) return 0;
  if (d.type === 'percent') {
    const pct100 = Math.round(Math.min(d.value, 100) * 100);
    return Math.min(Math.round((base * pct100) / 10000), base);
  }
  return Math.min(Math.round(d.value), base);
}

export const lineGross = (i: Pick<CartItem, 'unitPrice' | 'quantity'>) => i.unitPrice * i.quantity;
export const lineDiscount = (i: CartItem) => calcDiscount(lineGross(i), i.discount);

export interface CartTotals {
  /** Sum of price x qty before any discount. */
  gross: number;
  itemDiscount: number;
  billDiscount: number;
  discount: number;
  /** What the customer pays. */
  total: number;
}

export function cartTotals(items: CartItem[], billDiscount?: Discount | null): CartTotals {
  let gross = 0;
  let itemDiscount = 0;
  for (const i of items) {
    gross += lineGross(i);
    itemDiscount += lineDiscount(i);
  }
  const base = gross - itemDiscount;
  const bill = calcDiscount(base, billDiscount);
  return { gross, itemDiscount, billDiscount: bill, discount: itemDiscount + bill, total: base - bill };
}

/** Error message for a discount input, or null when valid. `base` = the amount being discounted. */
export function validateDiscount(base: number, d: Discount | null, opts?: { mustLeavePositive?: boolean }): string | null {
  if (!d) return null;
  if (!(d.value > 0)) return t('Isi nilai diskon lebih dari 0.');
  if (d.type === 'percent') {
    if (d.value > 100) return t('Diskon persen tidak boleh lebih dari 100.');
    if (Math.round(d.value * 100) !== d.value * 100 && Math.abs(Math.round(d.value * 100) - d.value * 100) > 1e-9)
      return t('Maksimal 2 angka di belakang koma.');
  } else if (!Number.isInteger(d.value)) {
    return t('Nominal diskon harus rupiah penuh.');
  }
  if (d.type === 'amount' && d.value > base) return t('Diskon melebihi harga.');
  if (opts?.mustLeavePositive && calcDiscount(base, d) >= base) return t('Diskon tidak boleh membuat total menjadi nol.');
  return null;
}

/** Short label: "10%" or "Rp 5.000". */
export function discountLabel(d: Discount | null | undefined, moneyFmt: (n: number) => string) {
  if (!d || !(d.value > 0)) return '';
  return d.type === 'percent' ? `${d.value}%` : moneyFmt(d.value);
}

/**
 * A line's discount share for a split bill: remaining line discount x qty / remaining qty;
 * the part that takes all remaining qty gets all remaining discount.
 * Same as the calculation in complete_checkout (split branch).
 */
export function splitLineDiscount(remainingDiscount: number, remainingQty: number, qty: number, gross: number): number {
  if (remainingDiscount <= 0 || remainingQty <= 0 || qty <= 0) return 0;
  const d = qty >= remainingQty ? remainingDiscount : Math.round((remainingDiscount * qty) / remainingQty);
  return Math.min(d, gross);
}

/** Discount payload for the RPC (only when there is one). */
export function discountPayload(d?: Discount | null) {
  return d && d.value > 0 ? { discount_type: d.type, discount_value: d.value } : {};
}
export function billDiscountPayload(d?: Discount | null) {
  return d && d.value > 0 ? { bill_discount_type: d.type, bill_discount_value: d.value } : {};
}
