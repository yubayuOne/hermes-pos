export type PaymentMethod = 'cash' | 'qris';
export type ProductStation = 'kitchen' | 'bar';
export type OrderStatus = 'draft' | 'held' | 'completed' | 'cancelled' | 'split' | 'voided';
export type DiscountType = 'percent' | 'amount';
/** percent: 0-100 (max 2 decimals). amount: Rp for the whole item line or the whole bill. Recomputed on the server. */
export interface Discount {
  type: DiscountType;
  value: number;
}
export type ShiftStatus = 'open' | 'closed';
export interface Category {
  id: string;
  name: string;
}
export interface Product {
  id: string;
  categoryId: string | null;
  name: string;
  hpp: number;
  price: number;
  stock: number;
  /** false = product without stock tracking (not limited, not reduced). Missing counts as true. */ trackStock?: boolean;
  imageUrl?: string | null;
  station: ProductStation;
}
export interface CartItem {
  productId: string;
  name: string;
  unitPrice: number;
  hpp: number;
  quantity: number;
  stock: number;
  trackStock?: boolean;
  station: ProductStation;
  discount?: Discount | null;
  /** Per-item note, e.g. "tanpa es" (no ice). */ note?: string | null;
}
export interface CustomerInfo {
  name: string;
  phone: string;
  table: string;
}
export interface PaymentInput {
  method: PaymentMethod;
  amountReceived: number;
  externalReference?: string;
}
export interface Shift {
  id: string;
  cashierId: string;
  businessDate: string;
  shiftNumber: number;
  openedAt: string;
  openingCash: number;
  status: ShiftStatus;
  closedAt?: string | null;
  closingCash?: number | null;
  expectedCash?: number | null;
  variance?: number | null;
  /** The phone that opened it (migration 051); null for older shifts, which any phone may use. */
  deviceId?: string | null;
}
/** itemId, refundedQty, trackStock: paid bills only (migration 033), used by refund. */
export interface TransactionItemSummary {
  itemId?: string;
  productId: string;
  productName: string;
  station: ProductStation;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  discount: number;
  note?: string | null;
  refundedQty?: number;
  trackStock?: boolean;
}
export interface TransactionSummary {
  id: string;
  number: string;
  customerName: string;
  customerPhone?: string;
  table: string;
  status: OrderStatus;
  total: number;
  paymentMethod?: PaymentMethod | null;
  createdAt: string;
  itemCount: number;
  items: TransactionItemSummary[];
  subtotal?: number;
  itemDiscount?: number;
  billDiscount?: number;
  voidReason?: string | null;
  refundedTotal?: number;
}
export interface CheckoutResult {
  transactionId: string;
  transactionNumber: string;
  total: number;
  change: number;
  voucherCode?: string;
  voucherDiscount?: number;
}
/** Voucher from pos_list_vouchers (migration 044), picked by the cashier. The server applies it again at checkout (032). */
export interface Voucher {
  code: string;
  scope: 'bill' | 'products';
  discountType: DiscountType;
  value: number;
  minSpend: number;
  productIds: string[];
}
/** A cashier registered on the device (owner) account. The server checks the PIN; the PIN hash is never sent to the app. */
export interface DeviceCashier {
  cashierId: string;
  cashierName: string;
  outletId: string;
  outletName: string;
  outletPhone?: string | null;
  outletAddress?: string | null;
  /** The outlet's own receipt text (migration 047); empty means the business text applies. */
  outletReceiptHeader?: string | null;
  outletReceiptFooter?: string | null;
  outletLogoUrl?: string | null;
  outletLogoPrintUrl?: string | null;
  terminalName: string;
  hasPin: boolean;
  pinLockedUntil?: string | null;
}
export type PinResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; lockedUntil: string }
  | { ok: false; reason: 'no_pin' | 'not_found' };
/** A shift in the outlet's history (list_outlet_shifts, migration 043). sales is net of refunds, from the server. */
export interface ShiftRecord extends Shift {
  cashierName: string;
  sales: number;
}
/** One refund with its reason (list_shift_refunds, list_bill_refunds, migration 043). */
export interface Refund {
  id: string;
  createdAt: string;
  number: string;
  method: PaymentMethod;
  amount: number;
  reason: string;
  cashierName: string;
  /** `amount`: the refunded money for that line (server, migration 043); missing in reports saved before it was kept. */
  items: Array<{ productName: string; quantity: number; amount?: number }>;
}
export interface AppSession {
  cashierId: string;
  cashierName: string;
  outletId: string;
  outletName: string;
  outletPhone?: string | null;
  outletAddress?: string | null;
  outletReceiptHeader?: string | null;
  outletReceiptFooter?: string | null;
  outletLogoUrl?: string | null;
  outletLogoPrintUrl?: string | null;
  terminalName: string;
}
