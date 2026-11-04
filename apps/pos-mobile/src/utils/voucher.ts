import { CartItem, Discount, Voucher } from '../types/domain';
import { calcDiscount, cartTotals, lineGross } from './discount';
import { money } from '../i18n';
import { t } from '../i18n';

/**
 * Screen copy of how migration 032 applies a voucher, so the till shows the same total the server will charge:
 * - bill voucher: becomes the bill discount (cannot be combined with a manual bill discount)
 * - product voucher: percent, or amount per line capped at the line price, on each matching line
 *   (cannot be combined with a manual item discount on that line)
 * - minimum spend compares with the subtotal before any discount
 * The server is still the one that decides; a mismatch only means the checkout is refused with a reason.
 */
export interface VoucherResult {
  items: CartItem[];
  billDiscount: Discount | null;
  cut: number;
  error: string | null;
}

export function applyVoucher(items: CartItem[], billDiscount: Discount | null, v: Voucher | null): VoucherResult {
  if (!v) return { items, billDiscount, cut: 0, error: null };
  const matches = (i: CartItem) => v.scope === 'products' && v.productIds.includes(i.productId) && lineGross(i) > 0;
  // Same order as the server: an item-discount clash first, then the minimum spend, then the rest.
  if (items.some((i) => matches(i) && i.discount)) {
    return { items, billDiscount, cut: 0, error: t('Voucher menu tidak bisa digabung dengan diskon item di menu yang sama.') };
  }
  const gross = items.reduce((n, i) => n + lineGross(i), 0);
  if (gross < v.minSpend) return { items, billDiscount, cut: 0, error: t('Belanja minimal {amount} untuk voucher ini.', { amount: money(v.minSpend) }) };
  if (v.scope === 'bill') {
    if (billDiscount) return { items, billDiscount, cut: 0, error: t('Voucher tidak bisa digabung dengan diskon bill.') };
    const base = cartTotals(items, null).total;
    if (v.discountType === 'amount' && v.value >= base) return { items, billDiscount, cut: 0, error: t('Potongan voucher lebih besar dari total bill.') };
    const d: Discount = { type: v.discountType, value: v.value };
    return { items, billDiscount: d, cut: calcDiscount(base, d), error: null };
  }
  let cut = 0;
  let matched = 0;
  const next = items.map((i) => {
    if (!matches(i)) return i;
    matched++;
    const d: Discount = { type: v.discountType, value: v.discountType === 'amount' ? Math.min(v.value, lineGross(i)) : v.value };
    cut += calcDiscount(lineGross(i), d);
    return { ...i, discount: d };
  });
  if (!matched) return { items, billDiscount, cut: 0, error: t('Voucher ini hanya untuk menu tertentu, dan menu itu tidak ada di bill.') };
  return { items: next, billDiscount, cut, error: null };
}

/** Totals shown on the bill footer and the payment screen, with the voucher separated from manual discounts. */
export function billTotals(items: CartItem[], billDiscount: Discount | null, v: Voucher | null) {
  const applied = applyVoucher(items, billDiscount, v);
  const usable = !applied.error;
  const totals = cartTotals(usable ? applied.items : items, usable ? applied.billDiscount : billDiscount);
  const voucherCut = usable ? applied.cut : 0;
  const isBill = v?.scope === 'bill' && usable;
  return {
    gross: totals.gross,
    itemDiscount: totals.itemDiscount - (isBill ? 0 : voucherCut),
    billDiscount: totals.billDiscount - (isBill ? voucherCut : 0),
    voucherCut,
    voucherError: v ? applied.error : null,
    total: totals.total,
  };
}
